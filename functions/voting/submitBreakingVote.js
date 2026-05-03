/**
 * voting/submitBreakingVote.js — 突發戰區投票（一話題一設備一票）
 *
 * 設計意圖：
 * - 突發戰區與主戰區獨立計數：寫入 global_events/{eventId}/votes/{deviceId}（匿名設備鎖）
 *   及 profiles/{uid}/breaking_votes/{eventId}（帳號存證），雙重查重確保無法繞過任一鎖。
 * - Vote-to-Reveal 策略：投票後立即在同一 Transaction 內更新 vote_counts，
 *   前端可在回傳結果中直接渲染計票條，無需再次 onSnapshot 等待。
 * - reCAPTCHA / Golden Key / Rate Limit 在 Transaction 外執行，降低 Firestore 寫入成本。
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue } from "../shared/admin.js";
import {
  GLOBAL_EVENTS_COLLECTION,
  CALLABLE_HTTP_OPTS,
} from "../shared/constants.js";
import {
  goatGoldenKeySecret,
  goatFingerprintPepperSecret,
  recaptchaSecretParam,
} from "../shared/secrets.js";
import {
  resolveGoldenKeySecret,
  resolveFingerprintPepper,
  resolveRecaptchaSecret,
} from "../shared/secretResolver.js";
import {
  requireAuth,
  enforceVoteRateLimit,
  enforceRecaptcha,
  shouldBypassHardSecurity,
  extractClientIp,
  logVoteSecurityEvent,
} from "../shared/security.js";
import { verifyGoldenKey } from "../utils/verifyGoldenKey.js";
import { hashDeviceFingerprintMaterial } from "../utils/fingerprintHash.js";
import { normalizeBreakingOptionIndex } from "../utils/normalizeBreakingOptionIndex.js";

export const submitBreakingVote = onCall(
  {
    ...CALLABLE_HTTP_OPTS,
    secrets: [goatGoldenKeySecret, goatFingerprintPepperSecret, recaptchaSecretParam],
  },
  async (request) => {
    requireAuth(request);

    const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);
    const fingerprintPepper = resolveFingerprintPepper(goatFingerprintPepperSecret);
    const recaptchaSecret = resolveRecaptchaSecret(recaptchaSecretParam);

    try {
      return await runSubmitBreakingVote(request.data, {
        auth: request.auth,
        rawRequest: request.rawRequest,
        goldenKeySecret,
        fingerprintPepper,
        recaptchaSecret,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[submitBreakingVote]", err?.message);
      throw new HttpsError("internal", "Breaking vote failed", { code: "breaking-vote-internal" });
    }
  }
);

async function runSubmitBreakingVote(data, context) {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required", { code: "auth-required" });
  }

  const { eventId, optionIndex, deviceId, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const eventIdStr = typeof eventId === "string" ? eventId.trim() : "";
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  const ip = extractClientIp(context);
  const fingerprintHashForRateLimit = hashDeviceFingerprintMaterial(deviceIdStr, context.fingerprintPepper);

  if (!eventIdStr || !deviceIdStr) {
    throw new HttpsError("invalid-argument", "eventId and deviceId required");
  }
  const option = normalizeBreakingOptionIndex(optionIndex);

  // 簽章 payload 必須與前端 createGoldenKeySignature(SUBMIT_BREAKING_VOTE, …) 完全一致：
  // 僅 { eventId, deviceId, optionIndex }，多帶 uid 會導致永遠 signature-mismatch。
  verifyGoldenKey(
    "submit_breaking_vote",
    { eventId: eventIdStr, deviceId: deviceIdStr, optionIndex: option },
    { xGoatTimestamp, xGoatSignature },
    { uid: context.auth.uid || null, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  await enforceVoteRateLimit({
    action: "submit_breaking_vote",
    uid,
    ip,
    fingerprintHash: fingerprintHashForRateLimit,
  });

  if (shouldBypassHardSecurity(context)) {
    logVoteSecurityEvent("warn", "submit_breaking_vote", "security-bypass", {
      uid, ip: ip || null, eventId: eventIdStr,
      origin: context.rawRequest?.headers?.origin || null,
    });
  } else {
    await enforceRecaptcha(context, recaptchaToken, {
      action: "submit_breaking_vote",
      uid,
      ip,
      extraLogFields: { eventId: eventIdStr },
    });
  }

  const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}`);
  const voteRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}/votes/${deviceIdStr}`);
  const profileBreakingRef = db.doc(`profiles/${uid}/breaking_votes/${eventIdStr}`);

  let debug = null;
  try {
    await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found");

      const profileBreakingSnap = await tx.get(profileBreakingRef);
      if (profileBreakingSnap.exists) {
        throw new HttpsError("failed-precondition", "Already voted on this topic", {
          code: "breaking-already-voted",
        });
      }

      const voteSnap = await tx.get(voteRef);
      if (voteSnap.exists) {
        throw new HttpsError("failed-precondition", "Already voted on this topic", {
          code: "breaking-already-voted",
        });
      }

      const eventData = eventSnap.data();
      const optionsArr = Array.isArray(eventData?.options) ? eventData.options : [];
      const optionsLen = optionsArr.length;
      const optionClamped = optionsLen > 0
        ? Math.max(0, Math.min(Math.floor(Number(option)), optionsLen - 1))
        : 0;

      tx.set(voteRef, { optionIndex: optionClamped, createdAt: FieldValue.serverTimestamp() });
      tx.set(profileBreakingRef, {
        optionIndex: optionClamped,
        deviceId: deviceIdStr,
        eventId: eventIdStr,
        createdAt: FieldValue.serverTimestamp(),
      });

      const existingVoteCounts = eventSnap.data()?.vote_counts;
      const voteCountsIsMapLike =
        existingVoteCounts && typeof existingVoteCounts === "object" && !Array.isArray(existingVoteCounts);

      // Vote-to-Reveal：確保 vote_counts Map 結構存在後再 increment，避免型別衝突。
      if (!voteCountsIsMapLike) {
        tx.set(eventRef, { vote_counts: {}, total_votes: 0 }, { merge: true });
      }
      tx.update(eventRef, {
        [`vote_counts.${optionClamped}`]: FieldValue.increment(1),
        total_votes: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

      debug = { eventId: eventIdStr, optionClamped, voteCountPath: `vote_counts.${optionClamped}` };
    });

    const afterSnap = await eventRef.get();
    const afterData = afterSnap.exists ? afterSnap.data() : null;
    return {
      ok: true,
      debug,
      total_votes: typeof afterData?.total_votes === "number" ? afterData.total_votes : 0,
      vote_counts: afterData?.vote_counts && typeof afterData.vote_counts === "object" ? afterData.vote_counts : {},
    };
  } catch (txnErr) {
    if (txnErr instanceof HttpsError) throw txnErr;
    functions.logger.error("[submitBreakingVote][transaction]", {
      message: txnErr?.message,
      code: txnErr?.code,
      eventId: eventIdStr,
      deviceId: deviceIdStr,
    });
    throw new HttpsError("failed-precondition", "Breaking vote transaction failed", {
      code: "breaking-transaction-failed",
      detail: txnErr?.message,
    });
  }
}
