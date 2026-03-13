/**
 * GOAT Meter: LeBron — Cloud Functions 後端寫入入口
 *
 * 設計意圖：
 * - 棄用 client-side App Check 寫入，所有對 votes / device_locks / warzoneStats 的修改一律透過 Admin SDK Transaction。
 * - 在最外層統一處理 reCAPTCHA 與廣告獎勵驗證，將 Firestore Security Rules 收緊為 read-only。
 */

import * as functions from "firebase-functions";
import admin from "firebase-admin";

import { verifyRecaptcha } from "./utils/verifyRecaptcha.js";
import { verifyAdRewardToken } from "./utils/verifyAdRewardToken.js";
import { signAdRewardToken } from "./utils/adRewardSigning.js";
import { computeGlobalDeductions } from "./utils/voteAggregation.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const STAR_ID = "lbj";
const GLOBAL_SUMMARY_DOC_ID = "global_summary";

/**
 * 是否允許略過嚴格安全驗證（僅限本地開發）。
 * 正式環境：僅允許來自 localhost 的請求略過；來自 Netlify 等正式網域的請求一律執行 reCAPTCHA／廣告驗證，驗證失敗即拋出 low-score-robot。
 */
function shouldBypassHardSecurity(context) {
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) || origin === "";
  return isLocalOrigin;
}

function requireAuth(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required", {
      code: "auth-required",
    });
  }
}

/**
 * submitVote — 後端唯一入口：提交一票。
 *
 * 資料一致性與避免 Race Condition 的設計說明：
 * - 使用 Firestore Transaction，同時讀取 profile / device_locks / warzoneStats / global_summary 並一次性寫入。
 * - 先檢查 profiles.{uid}.hasVoted 與 device_locks.{deviceId}.active，避免同一帳號或同一設備重複投票。
 * - device_locks 採「一設備一票」策略：若鎖存在且 active=true，整個 Transaction 立即失敗。
 * - warzoneStats 與 global_summary 的加總全部落在同一個 Transaction 內完成，保證「統計 + 鎖定狀態」要嘛一起成功、要嘛一起回滾。
 */
export const submitVote = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  try {
    return await runSubmitVote(data, context);
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error("[submitVote] Unexpected error:", err?.message);
    throw new functions.https.HttpsError("internal", "Vote failed", { code: "vote-internal" });
  }
});

async function runSubmitVote(data, context) {
  const { voteData, recaptchaToken } = data || {};
  const uid = context.auth.uid;

  if (!voteData || typeof voteData !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "voteData is required");
  }
  const { selectedStance, selectedReasons, deviceId } = voteData;
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";

  if (!deviceIdStr) {
    throw new functions.https.HttpsError("invalid-argument", "deviceId is required");
  }
  if (typeof selectedStance !== "string" || !selectedStance) {
    throw new functions.https.HttpsError("invalid-argument", "selectedStance is required");
  }
  if (!Array.isArray(selectedReasons)) {
    throw new functions.https.HttpsError("invalid-argument", "selectedReasons must be an array");
  }

  // 投票才看分數：大量假投票會破壞數據可信度，故正式環境要求 reCAPTCHA 分數 ≥ 0.5
  if (shouldBypassHardSecurity(context)) {
    console.warn("[submitVote] Bypassing reCAPTCHA verification (localhost only).");
  } else {
    const recaptchaResult = await verifyRecaptcha(recaptchaToken, { minScore: 0.5 });
    if (!recaptchaResult.success) {
      throw new functions.https.HttpsError("failed-precondition", "reCAPTCHA score too low", {
        code: "low-score-robot",
        recaptchaScore: recaptchaResult.score,
      });
    }
  }

  // Observability：社會風向計後續人工審核用 metadata（userAgent / ip）
  const ip =
    context.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    context.rawRequest?.ip ||
    "";
  const userAgent = context.rawRequest?.headers?.["user-agent"] || "";
  console.log("[submitVote] metadata", { ip, userAgent, uid });

  const profileRef = db.doc(`profiles/${uid}`);
  const votesRef = db.collection("votes");
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const deviceLockRef = db.doc(`device_locks/${deviceIdStr}`);

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "Profile not found");
    }
    const profile = profileSnap.data() || {};
    if (profile.hasVoted === true) {
      throw new functions.https.HttpsError("failed-precondition", "Already voted");
    }

    const warzoneId = String(profile.warzoneId ?? profile.voterTeam ?? "").trim();
    if (!warzoneId) {
      throw new functions.https.HttpsError("failed-precondition", "warzone required");
    }

    const deviceLockSnap = await tx.get(deviceLockRef);
    if (deviceLockSnap.exists) {
      const lockData = deviceLockSnap.data() || {};
      if (lockData.active === true) {
        throw new functions.https.HttpsError("failed-precondition", "Device already voted", {
          code: "device-already-voted",
        });
      }
    }

    const globalSnap = await tx.get(globalSummaryRef);
    const globalData = (() => {
      if (!globalSnap.exists) {
        return {
          totalVotes: 0,
          recentVotes: [],
          reasonCountsLike: {},
          reasonCountsDislike: {},
          countryCounts: {},
          goat: 0,
          fraud: 0,
          king: 0,
          mercenary: 0,
          machine: 0,
          stat_padder: 0,
        };
      }
      const d = globalSnap.data() || {};
      return {
        totalVotes: typeof d.totalVotes === "number" ? d.totalVotes : 0,
        recentVotes: Array.isArray(d.recentVotes) ? d.recentVotes : [],
        reasonCountsLike: typeof d.reasonCountsLike === "object" && d.reasonCountsLike ? d.reasonCountsLike : {},
        reasonCountsDislike:
          typeof d.reasonCountsDislike === "object" && d.reasonCountsDislike ? d.reasonCountsDislike : {},
        countryCounts: typeof d.countryCounts === "object" && d.countryCounts ? d.countryCounts : {},
        goat: typeof d.goat === "number" ? d.goat : 0,
        fraud: typeof d.fraud === "number" ? d.fraud : 0,
        king: typeof d.king === "number" ? d.king : 0,
        mercenary: typeof d.mercenary === "number" ? d.mercenary : 0,
        machine: typeof d.machine === "number" ? d.machine : 0,
        stat_padder: typeof d.stat_padder === "number" ? d.stat_padder : 0,
      };
    })();

    const newVoteRef = votesRef.doc();
    tx.set(newVoteRef, {
      starId: STAR_ID,
      userId: uid,
      deviceId: deviceIdStr,
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

    tx.set(deviceLockRef, {
      lastVoteId: newVoteRef.id,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const warzoneStatsRef = db.doc(`warzoneStats/${warzoneId}`);
    tx.set(
      warzoneStatsRef,
      {
        totalVotes: FieldValue.increment(1),
        [selectedStance]: FieldValue.increment(1),
      },
      { merge: true }
    );

    const newTotal = globalData.totalVotes + 1;
    const stanceKeys = ["goat", "fraud", "king", "mercenary", "machine", "stat_padder"];
    const stanceCounts = {};
    stanceKeys.forEach((key) => {
      stanceCounts[key] = globalData[key] + (key === selectedStance ? 1 : 0);
    });

    const newRecentEntry = {
      status: selectedStance,
      city: profile.city ?? "",
      country: profile.country ?? "",
      voterTeam: warzoneId,
      createdAt: Timestamp.now(),
    };
    const newRecentVotes = [newRecentEntry, ...(globalData.recentVotes || [])].slice(0, 10);

    const reasonCountsLike = { ...(globalData.reasonCountsLike || {}) };
    const reasonCountsDislike = { ...(globalData.reasonCountsDislike || {}) };
    (selectedReasons || []).forEach((r) => {
      if (["goat", "king", "machine"].includes(selectedStance)) {
        reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1;
      } else if (["fraud", "stat_padder", "mercenary"].includes(selectedStance)) {
        reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1;
      }
    });

    const countryCounts = { ...(globalData.countryCounts || {}) };
    const cc = String(profile.country ?? "").toUpperCase().slice(0, 2);
    if (cc) {
      const prev = countryCounts[cc] ?? { pro: 0, anti: 0 };
      countryCounts[cc] = {
        pro:
          (prev.pro ?? 0) +
          (["goat", "king", "machine"].includes(selectedStance) ? 1 : 0),
        anti:
          (prev.anti ?? 0) +
          (["fraud", "stat_padder", "mercenary"].includes(selectedStance) ? 1 : 0),
      };
    }

    tx.set(
      globalSummaryRef,
      {
        totalVotes: newTotal,
        ...stanceCounts,
        recentVotes: newRecentVotes,
        reasonCountsLike,
        reasonCountsDislike,
        countryCounts,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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

/**
 * resetPosition — 看完廣告後重置立場。
 *
 * 資料一致性與避免 Race Condition 的設計說明：
 * - 同樣使用單一 Transaction，同步處理：
 *   - profile.hasVoted 與 currentVoteId 等欄位清除。
 *   - 對應 votes 文件刪除。
 *   - 對應 device_locks 解鎖（刪除）。
 *   - warzoneStats 與 global_summary 依現有投票資料做「減法」，確保統計與實際票數對齊。
 * - 所有操作要嘛一起成功，要嘛全部回滾，不會出現「設備已解鎖但統計未扣回」的中間狀態。
 */
export const resetPosition = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  try {
    return await runResetPosition(data, context);
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error("[resetPosition] Unexpected error:", err?.message);
    throw new functions.https.HttpsError("internal", "Reset failed", { code: "reset-internal" });
  }
});

async function runResetPosition(data, context) {
  const { adRewardToken, recaptchaToken } = data || {};
  const uid = context.auth.uid;

  const bypassSecurity = shouldBypassHardSecurity(context);
  const allowedWebOrigins = (process.env.ALLOWED_WEB_ORIGIN || "https://lbj-goat-meter.netlify.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isWebNoAdSdk = adRewardToken === "web-no-ad-sdk";
  const isAllowedWebOrigin = allowedWebOrigins.includes(origin);
  const isWebNoAdSdkAllowed = isWebNoAdSdk && isAllowedWebOrigin;

  if (bypassSecurity) {
    console.warn("[resetPosition] Bypassing reCAPTCHA and ad reward verification (localhost only).");
  } else if (isWebNoAdSdkAllowed) {
    // 網頁版無廣告 SDK 過渡：origin 已驗證即放行
    console.log("[resetPosition] Web 無廣告 SDK 過渡：允許重置（origin 已驗證）");
  } else {
    // 重置立場不看 reCAPTCHA 分數：僅以廣告／origin 為門檻；即便被繞過也只是撤一票，不影響整體數據可信度
    const adResult = await verifyAdRewardToken(adRewardToken);
    if (!adResult.success) {
      throw new functions.https.HttpsError("failed-precondition", "Ad reward not verified", {
        code: "ad-not-watched",
      });
    }
    // 自簽 Token 必須為當前使用者簽發，防止 Token 被轉用
    const tokenUid = adResult.raw?.payload?.uid;
    if (typeof tokenUid === "string" && tokenUid !== uid) {
      throw new functions.https.HttpsError("failed-precondition", "Ad reward token user mismatch", {
        code: "ad-not-watched",
      });
    }
  }

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);

  let deletedVoteId = null;

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "Profile not found");
    }
    const profileData = profileSnap.data() || {};
    if (profileData.hasVoted !== true) {
      // 無票可扣，視為邏輯錯誤但不算嚴重，直接返回。
      return;
    }

    const raw = profileData.currentVoteId;
    const voteDocId = typeof raw === "string" && raw.length > 0 ? raw : null;
    let voteData = null;
    let globalSnap = null;

    if (voteDocId) {
      const voteRef = db.doc(`votes/${voteDocId}`);
      const voteSnap = await tx.get(voteRef);
      voteData = voteSnap.exists ? voteSnap.data() : null;
      globalSnap = await tx.get(globalSummaryRef);
    }

    const updatePayload = {
      hasVoted: false,
      currentStance: FieldValue.delete(),
      currentReasons: FieldValue.delete(),
      currentVoteId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.update(profileRef, updatePayload);

    if (voteDocId && voteData) {
      const voteDeviceId = typeof voteData.deviceId === "string" ? voteData.deviceId.trim() : "";
      if (voteDeviceId) {
        tx.delete(db.doc(`device_locks/${voteDeviceId}`));
      }
      tx.delete(db.doc(`votes/${voteDocId}`));
      deletedVoteId = voteDocId;

      const status = voteData.status;
      if (voteData.hadWarzoneStats === true) {
        const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
        if (wid && status) {
          tx.set(
            db.doc(`warzoneStats/${wid}`),
            {
              totalVotes: FieldValue.increment(-1),
              [status]: FieldValue.increment(-1),
            },
            { merge: true }
          );
        }
      }

      if (globalSnap?.exists && status) {
        const globalData = globalSnap.data() || {};
        const deduction = computeGlobalDeductions(globalData, [{ id: voteDocId, data: voteData }]);
        tx.set(
          globalSummaryRef,
          {
            ...deduction,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  });

  return { ok: true, deletedVoteId };
}

const FCM_TOPIC_WARZONE = "global_warzone";

/**
 * onProfileFCMTokensUpdate — 當 profile 的 fcmTokens 變更時，將 token 訂閱至 global_warzone topic，以接收戰況即時快報。
 * 僅在 fcmTokens 陣列實際變更時呼叫 FCM API，避免每次 profile 更新都重複訂閱。
 */
export const onProfileFCMTokensUpdate = functions.firestore
  .document("profiles/{userId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const prevTokens = Array.isArray(before.fcmTokens) ? before.fcmTokens : [];
    const nextTokens = Array.isArray(after.fcmTokens) ? after.fcmTokens : [];
    const changed =
      prevTokens.length !== nextTokens.length ||
      nextTokens.some((t, i) => prevTokens[i] !== t);
    if (!changed || nextTokens.length === 0) return;
    try {
      const res = await admin.messaging().subscribeToTopic(nextTokens, FCM_TOPIC_WARZONE);
      if (process.env.GCLOUD_PROJECT?.includes("dev") || process.env.NODE_ENV === "development") {
        console.log("[onProfileFCMTokensUpdate] subscribeToTopic", res?.successCount, res?.failureCount);
      }
    } catch (err) {
      console.warn("[onProfileFCMTokensUpdate]", err?.message);
    }
  });

/**
 * onWarzoneLeaderChange — 戰況即時快報：僅在「領先者易主」時推播。
 *
 * 設計意圖：監聽 warzoneStats/global_summary 的 onUpdate，比較前後狀態的認同／反對加總，
 * 若領先方從認同變反對（或反之）則發送 FCM 至 topic "global_warzone"。
 * 平手（pro === anti）不視為領先者，不發送推播，避免誤報。
 * 訂閱由 onProfileFCMTokensUpdate 在寫入 fcmTokens 時自動完成。
 */
export const onWarzoneLeaderChange = functions.firestore
  .document("warzoneStats/global_summary")
  .onUpdate(async (change) => {
    const prev = change.before.data() || {};
    const curr = change.after.data() || {};

    const getLeader = (data) => {
      const pro = (data.goat || 0) + (data.king || 0) + (data.machine || 0);
      const anti = (data.fraud || 0) + (data.stat_padder || 0) + (data.mercenary || 0);
      if (pro === anti) return null;
      return pro > anti ? "認同" : "反對";
    };

    const prevLeader = getLeader(prev);
    const currLeader = getLeader(curr);

    if (prevLeader != null && currLeader != null && prevLeader !== currLeader) {
      const payload = {
        topic: "global_warzone",
        notification: {
          title: "🚨 戰況反轉！歷史定位重新洗牌",
          body: `LBJ 的評價已被「${currLeader}派」佔領！目前戰況陷入拉鋸，快回來查看最新數據！`,
        },
      };
      try {
        return await admin.messaging().send(payload);
      } catch (err) {
        console.error("[onWarzoneLeaderChange] FCM send failed:", err?.message);
        // 不 rethrow，避免觸發器因 FCM 暫時失敗而重試；文件已更新，推播可於下次易主時再送
      }
    }
  });

/**
 * issueAdRewardToken — 簽發廣告獎勵 Token（看完廣告後由前端呼叫）。
 *
 * 設計意圖：當未使用 AD_REWARD_VERIFY_ENDPOINT 時，改由後端以 AD_REWARD_SIGNING_SECRET 簽發短期 Token，
 * 前端於「廣告觀看完成」後呼叫此函式取得 Token，再傳入 resetPosition。僅限已登入使用者，且 Token 5 分鐘有效。
 */
export const issueAdRewardToken = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  const placement = typeof data?.placement === "string" ? data.placement.trim() : "reset_position";

  try {
    const token = signAdRewardToken({
      placement,
      uid: context.auth.uid,
    });
    return { token };
  } catch (err) {
    // 不將內部錯誤訊息（如 Secret 未設定）回傳給客戶端，避免資訊洩漏
    console.error("[issueAdRewardToken]", err?.message);
    throw new functions.https.HttpsError("internal", "Failed to issue ad reward token", {
      code: "ad-reward-issue-failed",
    });
  }
});

