/**
 * voting/resetPosition.js — 看完廣告後重置投票立場
 *
 * 設計意圖：
 * - 重置立場是高風險操作（統計扣回 + 設備鎖解除），因此同樣以單一 Transaction 完成，
 *   確保「profile 清除 / vote 刪除 / device_lock 解鎖 / 統計扣回」同生共死。
 * - 廣告獎勵驗證在 Transaction 外，避免驗證成本消耗 Firestore 配額。
 * - 網頁版（無 AdMob SDK）允許以 origin 白名單 + "web-no-ad-sdk" token 放行；
 *   本機開發允許 "dev-bypass-localhost" token + localhost origin 放行，
 *   這兩條例外路徑均不依賴 ALLOW_SECURITY_BYPASS_LOCALHOST 旗標，職責分離。
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue } from "../shared/admin.js";
import { GLOBAL_SUMMARY_DOC_ID, CALLABLE_HTTP_OPTS } from "../shared/constants.js";

// 允許的網頁 origin 白名單：env var 於冷啟動時固定，module 層級解析一次即可，不需每次請求重新 split。
const _defaultAllowedOrigins = "https://lbj-goat-meter.netlify.app,https://lbj-goat-meter.web.app,https://lbj-goat-meter.firebaseapp.com";
const ALLOWED_WEB_ORIGINS = (process.env.ALLOWED_WEB_ORIGIN || _defaultAllowedOrigins)
  .split(",").map((s) => s.trim()).filter(Boolean);
import { goatGoldenKeySecret, adRewardSigningSecret } from "../shared/secrets.js";
import { resolveGoldenKeySecret, resolveAdRewardSigningSecret } from "../shared/secretResolver.js";
import { requireAuth, shouldBypassHardSecurity } from "../shared/security.js";
import { verifyGoldenKey } from "../utils/verifyGoldenKey.js";
import { verifyAdRewardToken } from "../utils/verifyAdRewardToken.js";
import { computeGlobalDeductions } from "../utils/voteAggregation.js";

export const resetPosition = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatGoldenKeySecret, adRewardSigningSecret] },
  async (request) => {
    requireAuth(request);

    const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);
    const adRewardSigningSecretResolved = resolveAdRewardSigningSecret(adRewardSigningSecret);

    try {
      return await runResetPosition(request.data, {
        auth: request.auth,
        rawRequest: request.rawRequest,
        goldenKeySecret,
        adRewardSigningSecret: adRewardSigningSecretResolved,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[resetPosition] Unexpected error:", err?.message);
      throw new HttpsError("internal", "Reset failed", { code: "reset-internal" });
    }
  }
);

async function runResetPosition(data, context) {
  const { adRewardToken, xGoatTimestamp, xGoatSignature, resetProfile } = data || {};
  // resetProfile = true：勾選「一併重設 profile」，在重置投票的同一 Transaction 中清除 voterTeam 等欄位，
  // 確保前端 hasSelectedWarzone 變為 false，VotingArena 回到 no_warzone 模式而非直接開放投票。
  const uid = context.auth.uid;

  verifyGoldenKey(
    "reset_position",
    { adRewardToken: adRewardToken || null },
    { xGoatTimestamp, xGoatSignature },
    { uid },
    context.goldenKeySecret || ""
  );

  const bypassSecurity = shouldBypassHardSecurity(context);
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isLocalWebOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  if (bypassSecurity) {
    console.warn("[resetPosition] Bypassing ad reward verification (localhost only).");
  } else if (adRewardToken === "web-no-ad-sdk" && ALLOWED_WEB_ORIGINS.includes(origin)) {
    // 網頁版過渡路徑：無廣告 SDK，以 origin 白名單驗證即放行
  } else if (isLocalWebOrigin && adRewardToken === "dev-bypass-localhost") {
    // 本機開發路徑：不依賴全域旁路旗標，僅允許 localhost
    console.warn("[resetPosition] Local web dev: dev-bypass-localhost + localhost origin — skipping ad reward verification.");
  } else {
    const adResult = await verifyAdRewardToken(adRewardToken, context.adRewardSigningSecret);
    if (!adResult.success) {
      throw new HttpsError("failed-precondition", "Ad reward not verified", { code: "ad-not-watched" });
    }
    const tokenUid = adResult.raw?.payload?.uid;
    if (typeof tokenUid === "string" && tokenUid !== uid) {
      throw new HttpsError("failed-precondition", "Ad reward token user mismatch", { code: "ad-not-watched" });
    }
  }

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  let deletedVoteId = null;

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) throw new HttpsError("failed-precondition", "Profile not found");

    const profileData = profileSnap.data() || {};
    if (profileData.hasVoted !== true) return; // 無票可扣，視為無操作

    const voteDocId = typeof profileData.currentVoteId === "string" && profileData.currentVoteId.length > 0
      ? profileData.currentVoteId
      : null;

    let voteData = null;
    let globalSnap = null;
    let warzoneRead = null;

    if (voteDocId) {
      const voteSnap = await tx.get(db.doc(`votes/${voteDocId}`));
      voteData = voteSnap.exists ? voteSnap.data() : null;
      globalSnap = await tx.get(globalSummaryRef);

      // 讀取 warzoneStats 必須在所有 write 之前（Firestore Transaction 規則）
      if (voteData?.hadWarzoneStats === true) {
        const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
        const st = typeof voteData.status === "string" ? voteData.status.trim() : "";
        if (wid && st) {
          const wzRef = db.doc(`warzoneStats/${wid}`);
          warzoneRead = { ref: wzRef, snap: await tx.get(wzRef), stance: st };
        }
      }
    }

    const profileClear = {
      hasVoted: false,
      currentStance: FieldValue.delete(),
      currentReasons: FieldValue.delete(),
      currentVoteId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    // resetProfile = true：清除 voterTeam 等欄位，前端 hasSelectedWarzone 將變為 false，
    // VotingArena 進入 no_warzone 模式，強制用戶重新完成戰區登錄後才能投票。
    if (resetProfile === true) {
      profileClear.hasProfile = false;
      profileClear.voterTeam = FieldValue.delete();
      profileClear.ageGroup = FieldValue.delete();
      profileClear.gender = FieldValue.delete();
      profileClear.city = FieldValue.delete();
      profileClear.coordinatesLocked = FieldValue.delete();
      profileClear.coordinates = FieldValue.delete();
    }
    tx.update(profileRef, profileClear);

    if (voteDocId && voteData) {
      const voteDeviceId = typeof voteData.deviceId === "string" ? voteData.deviceId.trim() : "";
      if (voteDeviceId) tx.delete(db.doc(`device_locks/${voteDeviceId}`));
      tx.delete(db.doc(`votes/${voteDocId}`));
      deletedVoteId = voteDocId;

      if (warzoneRead) {
        const w = warzoneRead.snap.exists ? warzoneRead.snap.data() || {} : {};
        const st = warzoneRead.stance;
        tx.set(
          warzoneRead.ref,
          {
            totalVotes: Math.max(0, (typeof w.totalVotes === "number" ? w.totalVotes : 0) - 1),
            [st]: Math.max(0, (typeof w[st] === "number" ? w[st] : 0) - 1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (globalSnap?.exists && voteData.status) {
        const deduction = computeGlobalDeductions(globalSnap.data() || {}, [{ id: voteDocId, data: voteData }]);
        tx.set(globalSummaryRef, { ...deduction, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  });

  return { ok: true, deletedVoteId };
}
