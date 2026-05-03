/**
 * voting/submitVote.js — 主戰區投票（一帳號一票）
 *
 * 設計意圖：
 * - 此為前端 VoteService.submitVote 的後端唯一對口，所有寫入操作集中於 Admin SDK Transaction。
 * - Transaction 內順序：讀取 profile → 讀取 device_lock → 讀取指紋查重 → 讀取 global_summary
 *   → 寫入 vote / device_lock / warzoneStats / global_summary / profile。
 *   嚴格遵守 Firestore Transaction「先讀後寫」規則，避免 already-started 錯誤。
 * - reCAPTCHA / Golden Key / Rate Limit 驗證在 Transaction 外執行，避免驗證失敗時消耗 Firestore 寫入配額。
 * - fingerprintHash 在 Transaction 外計算一次後傳入 closure，不重複雜湊（避免兩次 HMAC-SHA256）。
 * - STANCE_KEYS / PRO_STANCES / ANTI_STANCES 從 utils/voteAggregation.js 匯入，確保與聚合邏輯單一來源。
 */
import * as functions from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue, Timestamp } from "../shared/admin.js";
import {
  STAR_ID,
  GLOBAL_SUMMARY_DOC_ID,
  CALLABLE_HTTP_OPTS,
} from "../shared/constants.js";
import {
  goatFingerprintPepperSecret,
  goatGoldenKeySecret,
  recaptchaSecretParam,
} from "../shared/secrets.js";
import {
  resolveFingerprintPepper,
  resolveGoldenKeySecret,
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
import { STANCE_KEYS, PRO_STANCES, ANTI_STANCES } from "../utils/voteAggregation.js";

export const submitVote = onCall(
  {
    ...CALLABLE_HTTP_OPTS,
    secrets: [goatFingerprintPepperSecret, goatGoldenKeySecret, recaptchaSecretParam],
  },
  async (request) => {
    requireAuth(request);

    const fingerprintPepper = resolveFingerprintPepper(goatFingerprintPepperSecret);
    const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);
    const recaptchaSecret = resolveRecaptchaSecret(recaptchaSecretParam);

    try {
      return await runSubmitVote(request.data, {
        auth: request.auth,
        rawRequest: request.rawRequest,
        fingerprintPepper,
        goldenKeySecret,
        recaptchaSecret,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[submitVote] Unexpected error:", err?.message);
      throw new HttpsError("internal", "Vote failed", { code: "vote-internal" });
    }
  }
);

async function runSubmitVote(data, context) {
  const { voteData, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const uid = context.auth.uid;

  if (!voteData || typeof voteData !== "object") {
    throw new HttpsError("invalid-argument", "voteData is required");
  }
  const { selectedStance, selectedReasons, deviceId } = voteData;
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  const ip = extractClientIp(context);

  if (!deviceIdStr) throw new HttpsError("invalid-argument", "deviceId is required");
  if (typeof selectedStance !== "string" || !selectedStance) {
    throw new HttpsError("invalid-argument", "selectedStance is required");
  }
  if (!Array.isArray(selectedReasons)) {
    throw new HttpsError("invalid-argument", "selectedReasons must be an array");
  }

  verifyGoldenKey(
    "submit_vote",
    { uid, deviceId: deviceIdStr, selectedStance },
    { xGoatTimestamp, xGoatSignature },
    { uid, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  // 計算一次，用於 rate limit 與 Transaction 內指紋查重，不重複執行 HMAC-SHA256。
  const fingerprintHash = hashDeviceFingerprintMaterial(deviceIdStr, context.fingerprintPepper);
  await enforceVoteRateLimit({ action: "submit_vote", uid, ip, fingerprintHash });

  if (shouldBypassHardSecurity(context)) {
    logVoteSecurityEvent("warn", "submit_vote", "security-bypass", {
      uid, ip: ip || null, origin: context.rawRequest?.headers?.origin || null,
    });
  } else {
    await enforceRecaptcha(context, recaptchaToken, { action: "submit_vote", uid, ip });
  }

  const profileRef = db.doc(`profiles/${uid}`);
  const votesRef = db.collection("votes");
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const deviceLockRef = db.doc(`device_locks/${deviceIdStr}`);

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) throw new HttpsError("failed-precondition", "Profile not found");

    const profile = profileSnap.data() || {};
    if (profile.hasVoted === true) throw new HttpsError("failed-precondition", "Already voted");

    const warzoneId = String(profile.warzoneId ?? profile.voterTeam ?? "").trim();
    if (!warzoneId) throw new HttpsError("failed-precondition", "warzone required");

    const deviceLockSnap = await tx.get(deviceLockRef);
    if (deviceLockSnap.exists && deviceLockSnap.data()?.active === true) {
      throw new HttpsError("failed-precondition", "Device already voted", { code: "device-already-voted" });
    }

    if (fingerprintHash) {
      const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dupSnap = await tx.get(
        db.collection("votes")
          .where("warzoneId", "==", warzoneId)
          .where("fingerprintHash", "==", fingerprintHash)
          .where("createdAt", ">=", cutoff)
          .limit(8)
      );
      for (const d of dupSnap.docs) {
        const otherUid = d.data()?.userId;
        if (otherUid && otherUid !== uid) {
          throw new HttpsError("permission-denied", "Device recently voted in this warzone", {
            code: "fingerprint-recent-vote",
          });
        }
      }
    }

    const globalSnap = await tx.get(globalSummaryRef);
    const globalData = globalSnap.exists
      ? (() => {
          const d = globalSnap.data() || {};
          return {
            totalVotes: typeof d.totalVotes === "number" ? d.totalVotes : 0,
            recentVotes: Array.isArray(d.recentVotes) ? d.recentVotes : [],
            reasonCountsLike: d.reasonCountsLike && typeof d.reasonCountsLike === "object" ? d.reasonCountsLike : {},
            reasonCountsDislike: d.reasonCountsDislike && typeof d.reasonCountsDislike === "object" ? d.reasonCountsDislike : {},
            countryCounts: d.countryCounts && typeof d.countryCounts === "object" ? d.countryCounts : {},
            ...Object.fromEntries(STANCE_KEYS.map((k) => [k, typeof d[k] === "number" ? d[k] : 0])),
          };
        })()
      : {
          totalVotes: 0, recentVotes: [], reasonCountsLike: {}, reasonCountsDislike: {}, countryCounts: {},
          ...Object.fromEntries(STANCE_KEYS.map((k) => [k, 0])),
        };

    const newVoteRef = votesRef.doc();
    tx.set(newVoteRef, {
      starId: STAR_ID,
      userId: uid,
      deviceId: deviceIdStr,
      ...(fingerprintHash ? { fingerprintHash } : {}),
      status: selectedStance,
      reasons: selectedReasons,
      warzoneId,
      voterTeam: warzoneId,
      ageGroup: profile.ageGroup ?? "",
      gender: profile.gender ?? "",
      country: profile.country ?? "",
      city: profile.city ?? "",
      hadWarzoneStats: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(deviceLockRef, { lastVoteId: newVoteRef.id, active: true, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`warzoneStats/${warzoneId}`), {
      totalVotes: FieldValue.increment(1),
      [selectedStance]: FieldValue.increment(1),
    }, { merge: true });

    const stanceCounts = Object.fromEntries(
      STANCE_KEYS.map((k) => [k, globalData[k] + (k === selectedStance ? 1 : 0)])
    );
    const newRecentVotes = [
      { status: selectedStance, city: profile.city ?? "", country: profile.country ?? "", voterTeam: warzoneId, createdAt: Timestamp.now() },
      ...(globalData.recentVotes || []),
    ].slice(0, 10);

    const reasonCountsLike = { ...(globalData.reasonCountsLike || {}) };
    const reasonCountsDislike = { ...(globalData.reasonCountsDislike || {}) };
    (selectedReasons || []).forEach((r) => {
      if (PRO_STANCES.has(selectedStance)) {
        reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1;
      } else if (ANTI_STANCES.has(selectedStance)) {
        reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1;
      }
    });

    const countryCounts = { ...(globalData.countryCounts || {}) };
    const cc = String(profile.country ?? "").toUpperCase().slice(0, 2);
    if (cc) {
      const prev = countryCounts[cc] ?? { pro: 0, anti: 0 };
      countryCounts[cc] = {
        pro: (prev.pro ?? 0) + (PRO_STANCES.has(selectedStance) ? 1 : 0),
        anti: (prev.anti ?? 0) + (ANTI_STANCES.has(selectedStance) ? 1 : 0),
      };
    }

    tx.set(globalSummaryRef, {
      totalVotes: globalData.totalVotes + 1,
      ...stanceCounts,
      recentVotes: newRecentVotes,
      reasonCountsLike,
      reasonCountsDislike,
      countryCounts,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.update(profileRef, {
      hasVoted: true,
      currentStance: selectedStance,
      currentReasons: selectedReasons,
      currentVoteId: newVoteRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
}
