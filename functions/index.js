/**
 * GOAT Meter: LeBron — Cloud Functions 後端寫入入口
 *
 * 設計意圖：
 * - 棄用 client-side App Check 寫入，所有對 votes / device_locks / warzoneStats 的修改一律透過 Admin SDK Transaction。
 * - 在最外層統一處理 reCAPTCHA 與廣告獎勵驗證，將 Firestore Security Rules 收緊為 read-only。
 * - Callable 已遷移至 Cloud Functions v2（記憶體 / 逾時 / minInstances 由 setGlobalOptions 統一設定）。
 */

import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import admin from "firebase-admin";

import { verifyRecaptcha } from "./utils/verifyRecaptcha.js";
import { verifyAdRewardToken } from "./utils/verifyAdRewardToken.js";
import { signAdRewardToken } from "./utils/adRewardSigning.js";
import { computeGlobalDeductions } from "./utils/voteAggregation.js";
import { verifyGoldenKey } from "./utils/verifyGoldenKey.js";
import { normalizeBreakingOptionIndex } from "./utils/normalizeBreakingOptionIndex.js";
import { resolveBreakingEventLocalizedText } from "./utils/resolveBreakingEventLocalizedText.js";
import { hashDeviceFingerprintMaterial } from "./utils/fingerprintHash.js";
import { computeSentimentSummaryFromRows } from "./utils/computeSentimentSummary.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: process.env.FUNCTIONS_REGION || "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
  minInstances: 0,
});

/** Gen2 Callable 並發：單一實例可同時處理多個請求，降低尖峰排隊（上限依配額與記憶體調整） */
const CALLABLE_HTTP_OPTS = { concurrency: 64 };

/** 與 Secret Manager 鍵名一致；submitVote 綁定後執行期由 Firebase 掛載至 secret.value() */
const goatFingerprintPepperSecret = defineSecret("GOAT_FINGERPRINT_PEPPER");
/** 與 Secret Manager 鍵名一致；供 Golden Key HMAC 驗證使用，取代已棄用的 functions.config()。 */
const goatGoldenKeySecret = defineSecret("GOAT_GOLDEN_KEY_SECRET");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const STAR_ID = (process.env.STAR_ID || process.env.GOAT_STAR_ID || "lbj").trim() || "lbj";
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
    throw new HttpsError("unauthenticated", "Authentication required", {
      code: "auth-required",
    });
  }
}

/**
 * 解析指紋用 pepper：優先 Gen2 secret.value()，失敗則 GOAT_FINGERPRINT_PEPPER（Emulator／本機）。
 * Cloud Run 上若兩者皆空會略過 24h 查重，故在 K_SERVICE 存在時寫 warn 便於營運發現未掛 Secret。
 */
function resolveFingerprintPepper(secret) {
  try {
    const v = secret.value();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Emulator 或未解析 secret 時改走環境變數
  }
  const fromEnv = process.env.GOAT_FINGERPRINT_PEPPER?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.K_SERVICE) {
    functions.logger.warn(
      "[submitVote] GOAT_FINGERPRINT_PEPPER 未解析：24h 裝置查重已停用，請確認 Secret 已綁定並部署"
    );
  }
  return "";
}

/**
 * 解析 Golden Key：優先讀取 Gen2 Secret Manager，失敗時回退環境變數（Emulator / 本機）。
 * 設計意圖：移除對 functions.config() 的依賴，避免 v2 服務在 Runtime Config 停用時失效。
 */
function resolveGoldenKeySecret(secret) {
  try {
    const v = secret.value();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Emulator 或未解析 secret 時改走環境變數
  }
  const fromEnv = (process.env.GOLDEN_KEY_SECRET || process.env.GOAT_GOLDEN_KEY_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  if (process.env.K_SERVICE) {
    functions.logger.warn("[GoldenKey] GOAT_GOLDEN_KEY_SECRET 未解析，簽章驗證將失敗。請確認 Secret 已綁定並部署。");
  }
  return "";
}

/**
 * submitVote — 後端唯一入口：提交一票。
 *
 * 資料一致性與避免 Race Condition 的設計說明：
 * - 使用 Firestore Transaction：讀取 profile、device_locks、global_summary、選擇性指紋查重；寫入 vote、device_lock、warzoneStats（increment）、global_summary、profile。
 * - 先檢查 profiles.{uid}.hasVoted 與 device_locks.{deviceId}.active，避免同一帳號或同一設備重複投票。
 * - device_locks 採「一設備一票」策略：若鎖存在且 active=true，整個 Transaction 立即失敗。
 * - warzoneStats 與 global_summary 的加總全部落在同一個 Transaction 內完成，保證「統計 + 鎖定狀態」要嘛一起成功、要嘛一起回滾。
 */
export const submitVote = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatFingerprintPepperSecret, goatGoldenKeySecret] },
  async (request) => {
    requireAuth(request);

    const fingerprintPepper = resolveFingerprintPepper(goatFingerprintPepperSecret);
    const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);

    try {
      return await runSubmitVote(request.data, {
        auth: request.auth,
        rawRequest: request.rawRequest,
        fingerprintPepper,
        goldenKeySecret,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[submitVote] Unexpected error:", err?.message);
      throw new HttpsError("internal", "Vote failed", { code: "vote-internal" });
    }
  }
);

/**
 * @param {unknown} data - Callable payload
 * @param {{ auth: { uid: string }; rawRequest?: unknown; fingerprintPepper?: string; goldenKeySecret?: string }} context
 */
async function runSubmitVote(data, context) {
  const { voteData, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const uid = context.auth.uid;

  if (!voteData || typeof voteData !== "object") {
    throw new HttpsError("invalid-argument", "voteData is required");
  }
  const { selectedStance, selectedReasons, deviceId } = voteData;
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";

  if (!deviceIdStr) {
    throw new HttpsError("invalid-argument", "deviceId is required");
  }
  if (typeof selectedStance !== "string" || !selectedStance) {
    throw new HttpsError("invalid-argument", "selectedStance is required");
  }
  if (!Array.isArray(selectedReasons)) {
    throw new HttpsError("invalid-argument", "selectedReasons must be an array");
  }

  // Golden Key：驗證前端簽章，避免未經授權腳本濫發請求。
  verifyGoldenKey(
    "submit_vote",
    {
      uid,
      deviceId: deviceIdStr,
      selectedStance,
    },
    { xGoatTimestamp, xGoatSignature },
    { uid, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  // 投票才看分數：大量假投票會破壞數據可信度，故正式環境要求 reCAPTCHA 分數 ≥ 0.5
  if (shouldBypassHardSecurity(context)) {
    console.warn("[submitVote] Bypassing reCAPTCHA verification (localhost only).");
  } else {
    const recaptchaResult = await verifyRecaptcha(recaptchaToken, { minScore: 0.5 });
    if (!recaptchaResult.success) {
      throw new HttpsError("failed-precondition", "reCAPTCHA verification failed", {
        code: "recaptcha-verify-failed",
        recaptchaScore: recaptchaResult.score,
        recaptchaError: recaptchaResult.raw?.error ?? null,
        recaptchaAction: recaptchaResult.action ?? null,
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
      throw new HttpsError("failed-precondition", "Profile not found");
    }
    const profile = profileSnap.data() || {};
    if (profile.hasVoted === true) {
      throw new HttpsError("failed-precondition", "Already voted");
    }

    const warzoneId = String(profile.warzoneId ?? profile.voterTeam ?? "").trim();
    if (!warzoneId) {
      throw new HttpsError("failed-precondition", "warzone required");
    }

    const deviceLockSnap = await tx.get(deviceLockRef);
    if (deviceLockSnap.exists) {
      const lockData = deviceLockSnap.data() || {};
      if (lockData.active === true) {
        throw new HttpsError("failed-precondition", "Device already voted", {
          code: "device-already-voted",
        });
      }
    }

    const fingerprintHash = hashDeviceFingerprintMaterial(deviceIdStr, context.fingerprintPepper);
    if (fingerprintHash) {
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
      const cutoff = Timestamp.fromMillis(cutoffMs);
      const dupQ = db
        .collection("votes")
        .where("warzoneId", "==", warzoneId)
        .where("fingerprintHash", "==", fingerprintHash)
        .where("createdAt", ">=", cutoff)
        .limit(8);
      const dupSnap = await tx.get(dupQ);
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
export const resetPosition = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatGoldenKeySecret] },
  async (request) => {
  requireAuth(request);

  const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);

  try {
    return await runResetPosition(request.data, {
      auth: request.auth,
      rawRequest: request.rawRequest,
      goldenKeySecret,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[resetPosition] Unexpected error:", err?.message);
    throw new HttpsError("internal", "Reset failed", { code: "reset-internal" });
  }
}
);

async function runResetPosition(data, context) {
  const { adRewardToken, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const uid = context.auth.uid;

  // 簽章 payload 必須與前端 createGoldenKeySignature(RESET_POSITION, …) 一致：僅 { adRewardToken }。
  verifyGoldenKey(
    "reset_position",
    { adRewardToken: adRewardToken || null },
    { xGoatTimestamp, xGoatSignature },
    { uid },
    context.goldenKeySecret || ""
  );

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
      throw new HttpsError("failed-precondition", "Ad reward not verified", {
        code: "ad-not-watched",
      });
    }
    // 自簽 Token 必須為當前使用者簽發，防止 Token 被轉用
    const tokenUid = adResult.raw?.payload?.uid;
    if (typeof tokenUid === "string" && tokenUid !== uid) {
      throw new HttpsError("failed-precondition", "Ad reward token user mismatch", {
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
      throw new HttpsError("failed-precondition", "Profile not found");
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

    /** 必須於任何 write 前先讀取 warzone（Firestore Transaction 規則） */
    let warzoneRead = null;
    if (voteDocId && voteData && voteData.hadWarzoneStats === true) {
      const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
      const st = typeof voteData.status === "string" ? voteData.status.trim() : "";
      if (wid && st) {
        const wzRef = db.doc(`warzoneStats/${wid}`);
        warzoneRead = { ref: wzRef, snap: await tx.get(wzRef), stance: st };
      }
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
      if (warzoneRead) {
        const w = warzoneRead.snap.exists ? warzoneRead.snap.data() || {} : {};
        const st = warzoneRead.stance;
        const curTotal = typeof w.totalVotes === "number" ? w.totalVotes : 0;
        const curStance = typeof w[st] === "number" ? w[st] : 0;
        tx.set(
          warzoneRead.ref,
          {
            totalVotes: Math.max(0, curTotal - 1),
            [st]: Math.max(0, curStance - 1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
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

/**
 * deleteUserAccount — 帳號刪除資料清理（後端全交易執行）。
 *
 * 設計意圖：
 * - 由 Admin SDK 在單一 Transaction 內完成扣票與刪除，避免前端權限不足造成 Permission Denied。
 * - 確保「統計遞減」與「文件刪除」同生共死，不會留下不一致的中間狀態。
 */
export const deleteUserAccount = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);
  const uid = request.auth.uid;

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const userVotesQuery = db
    .collection("votes")
    .where("userId", "==", uid)
    .where("starId", "==", STAR_ID)
    .limit(500);
  const profileBreakingVotesQuery = db.collection(`profiles/${uid}/breaking_votes`).limit(500);

  try {
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const globalSnap = await tx.get(globalSummaryRef);
      const userVotesSnap = await tx.get(userVotesQuery);
      const profileBreakingVotesSnap = await tx.get(profileBreakingVotesQuery);

      // 防禦性門檻：避免 limit 命中時只刪掉前 500 筆造成「部分成功」。
      // 若資料量超出可安全交易範圍，直接中止並回報，維持資料一致性優先。
      if (userVotesSnap.size >= 500) {
        throw new HttpsError(
          "failed-precondition",
          "Too many votes to delete safely in a single transaction",
          { code: "delete-account-too-many-votes", count: userVotesSnap.size }
        );
      }
      if (profileBreakingVotesSnap.size >= 500) {
        throw new HttpsError(
          "failed-precondition",
          "Too many breaking votes to delete safely in a single transaction",
          { code: "delete-account-too-many-breaking-votes", count: profileBreakingVotesSnap.size }
        );
      }

      const userVoteRows = userVotesSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

      const breakingRows = [];
      for (const proofDoc of profileBreakingVotesSnap.docs) {
        const proofData = proofDoc.data() || {};
        const eventId = proofDoc.id;
        const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}`);
        const eventSnap = await tx.get(eventRef);
        breakingRows.push({
          eventId,
          proofRef: proofDoc.ref,
          proofData,
          eventRef,
          eventSnap,
        });
      }

      // 扣回戰區票數（地方戰區）
      const warzoneDeltas = new Map();
      for (const row of userVoteRows) {
        const vote = row.data || {};
        if (vote.hadWarzoneStats !== true) continue;
        const status = typeof vote.status === "string" ? vote.status.trim() : "";
        const warzoneId = String(vote.warzoneId || vote.voterTeam || "").trim();
        if (!status || !warzoneId) continue;
        if (!warzoneDeltas.has(warzoneId)) {
          warzoneDeltas.set(warzoneId, { totalVotes: 0, stance: {} });
        }
        const bucket = warzoneDeltas.get(warzoneId);
        bucket.totalVotes -= 1;
        bucket.stance[status] = (bucket.stance[status] || 0) - 1;
      }
      const warzoneSnapById = new Map();
      for (const warzoneId of warzoneDeltas.keys()) {
        warzoneSnapById.set(warzoneId, await tx.get(db.doc(`warzoneStats/${warzoneId}`)));
      }
      for (const [warzoneId, delta] of warzoneDeltas.entries()) {
        const warzoneRef = db.doc(`warzoneStats/${warzoneId}`);
        const wzSnap = warzoneSnapById.get(warzoneId);
        const w = wzSnap?.exists ? wzSnap.data() || {} : {};
        const curTotal = typeof w.totalVotes === "number" ? w.totalVotes : 0;
        const newTotal = Math.max(0, curTotal + delta.totalVotes);
        const payload = {
          totalVotes: newTotal,
          updatedAt: FieldValue.serverTimestamp(),
        };
        Object.entries(delta.stance).forEach(([status, count]) => {
          const cur = typeof w[status] === "number" ? w[status] : 0;
          payload[status] = Math.max(0, cur + count);
        });
        tx.set(warzoneRef, payload, { merge: true });
      }

      // 扣回 global_summary（全域戰區）
      if (globalSnap.exists && userVoteRows.length > 0) {
        const globalData = globalSnap.data() || {};
        const deduction = computeGlobalDeductions(globalData, userVoteRows);
        tx.set(
          globalSummaryRef,
          {
            ...deduction,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 扣回突發戰區票數，並刪除 global_events/{eventId}/votes/{deviceId} + profile 存證
      for (const row of breakingRows) {
        const { eventId, proofData, eventRef, eventSnap, proofRef } = row;
        if (eventSnap.exists) {
          const eventData = eventSnap.data() || {};
          const options = Array.isArray(eventData.options) ? eventData.options : [];
          const optionsLen = options.length;
          const rawOptionIndex = Number(proofData.optionIndex);
          const clampedOptionIndex =
            optionsLen > 0 && Number.isFinite(rawOptionIndex)
              ? Math.max(0, Math.min(Math.floor(rawOptionIndex), optionsLen - 1))
              : 0;
          const voteCountPath = `vote_counts.${clampedOptionIndex}`;
          tx.update(eventRef, {
            total_votes: FieldValue.increment(-1),
            [voteCountPath]: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const deviceId = typeof proofData.deviceId === "string" ? proofData.deviceId.trim() : "";
        if (deviceId) {
          tx.delete(db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}/votes/${deviceId}`));
        }
        tx.delete(proofRef);
      }

      // 刪除主戰區 votes 與 device_locks
      for (const row of userVoteRows) {
        const vote = row.data || {};
        const deviceId = typeof vote.deviceId === "string" ? vote.deviceId.trim() : "";
        if (deviceId) {
          tx.delete(db.doc(`device_locks/${deviceId}`));
        }
        tx.delete(db.doc(`votes/${row.id}`));
      }

      if (profileSnap.exists) {
        tx.delete(profileRef);
      }
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[deleteUserAccount] Unexpected error:", err?.message);
    throw new HttpsError("internal", "Delete account failed", {
      code: "delete-account-internal",
    });
  }
});

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

const GLOBAL_EVENTS_COLLECTION = "global_events";

const BREAKING_PUSH_TITLE_FALLBACK = "🚨 突發戰區：新話題上線！";
const BREAKING_PUSH_BODY_FALLBACK = "歷史定位由你決定，立即參與即時投票。";

/**
 * 突發戰區「已發佈」推播：與 onCreate / 從草稿發佈（onUpdate）共用。
 * 成功發送後寫入 pushSent，避免同一議題重複推播（含觸發器重試與 is_active 來回切換）。
 *
 * FCM 與 Firestore update 分開 try：若推播已成功但 update 失敗，不可 rethrow 整段（否則觸發器重試會重複推播）；
 * 此時僅記錄，必要時依 log 手動補寫 pushSent。
 *
 * @param {FirebaseFirestore.DocumentReference} eventRef
 * @param {string} eventId
 * @param {Record<string, unknown>} eventData
 * @param {string} logLabel
 */
async function sendBreakingPublishedTopicPush(eventRef, eventId, eventData, logLabel) {
  if (eventData.pushSent === true) return;

  const title = resolveBreakingEventLocalizedText(eventData.title, BREAKING_PUSH_TITLE_FALLBACK);
  const body = resolveBreakingEventLocalizedText(eventData.description, BREAKING_PUSH_BODY_FALLBACK);

  const message = {
    topic: FCM_TOPIC_WARZONE,
    notification: {
      title,
      body,
    },
    data: {
      type: "BREAKING_VOTE",
      eventId: String(eventId),
    },
    android: {
      priority: "high",
      notification: {
        channelId: "breaking_warzone_channel",
        clickAction: "TOP_LEVEL_SCENE",
      },
    },
    apns: {
      payload: {
        aps: {
          category: "BREAKING_VOTE",
          sound: "default",
        },
      },
    },
  };

  try {
    await admin.messaging().send(message);
  } catch (error) {
    functions.logger.error(`[${logLabel}] FCM send failed`, {
      eventId,
      message: error?.message,
    });
    return;
  }

  try {
    await eventRef.update({
      pushSent: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    functions.logger.info(`[${logLabel}] push success`, { eventId });
  } catch (error) {
    functions.logger.error(`[${logLabel}] pushSent persist failed (FCM already sent)`, {
      eventId,
      message: error?.message,
    });
  }
}

/**
 * onNewBreakingEvent — 突發戰區發佈通知：新議題建立時推播至 global_warzone topic（與 onWarzoneLeaderChange 主投票通知並存）。
 *
 * 設計意圖：data 帶 eventId（字串）供客戶端點擊後深連；略過草稿 status、未啟用 is_active、或空文件，避免洗版。
 * FCM data payload 值須全為字串；notification title/body 必須為字串（後台欄位為本地化物件時需先解析）。
 */
export const onNewBreakingEvent = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onCreate(async (snapshot, context) => {
    const eventData = snapshot.data();
    if (!eventData) return;
    if (eventData.status === "draft") return;
    // 與 UniversalAdmin 一致：is_active === false 時不推播（略過未定義以相容舊文件）
    if (eventData.is_active === false) return;
    if (eventData.pushSent === true) return;

    const eventId = context.params.eventId;
    await sendBreakingPublishedTopicPush(snapshot.ref, eventId, eventData, "onNewBreakingEvent");
  });

/**
 * onBreakingEventUpdate — 草稿發佈通知：監聽 global_events/{eventId} onUpdate。
 *
 * 觸發：before.is_active === false && after.is_active === true。
 * 門禁：after.pushSent === true 或 after.status === 'draft' 不送（與 onCreate 共用 sendBreakingPublishedTopicPush + pushSent）。
 * 寫入 pushSent 後會再觸發 onUpdate，但因不符合 false→true，不會迴圈推播。
 */
export const onBreakingEventUpdate = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    if (!(before.is_active === false && after.is_active === true)) return;
    if (after.pushSent === true || after.status === "draft") return;

    const eventId = context.params.eventId;
    await sendBreakingPublishedTopicPush(change.after.ref, eventId, after, "onBreakingEventUpdate");
  });

/**
 * submitBreakingVote — 突發戰區投票：一話題一設備一票，寫入 global_events/{eventId}/votes/{deviceId}。
 */
export const submitBreakingVote = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatGoldenKeySecret] },
  async (request) => {
  requireAuth(request);

  const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);

  try {
    return await runSubmitBreakingVote(request.data, {
      auth: request.auth,
      rawRequest: request.rawRequest,
      goldenKeySecret,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[submitBreakingVote]", err?.message);
    throw new HttpsError("internal", "Breaking vote failed", {
      code: "breaking-vote-internal",
    });
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
  if (!eventIdStr || !deviceIdStr) {
    throw new HttpsError("invalid-argument", "eventId and deviceId required");
  }
  const option = normalizeBreakingOptionIndex(optionIndex);

  // 簽章 payload 必須與前端 createGoldenKeySignature(SUBMIT_BREAKING_VOTE, …) 完全一致：
  // 僅 { eventId, deviceId, optionIndex }。若後端多帶 uid，JSON.stringify 不同會永遠 signature-mismatch。
  verifyGoldenKey(
    "submit_breaking_vote",
    {
      eventId: eventIdStr,
      deviceId: deviceIdStr,
      optionIndex: option,
    },
    { xGoatTimestamp, xGoatSignature },
    { uid: context.auth.uid || null, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  if (!shouldBypassHardSecurity(context)) {
    let recaptchaResult;
    try {
      recaptchaResult = await verifyRecaptcha(recaptchaToken, { minScore: 0.5 });
    } catch (recaptchaErr) {
      functions.logger.error("[submitBreakingVote][recaptcha-config]", {
        message: recaptchaErr?.message,
        uid: context.auth?.uid,
      });
      throw new HttpsError(
        "failed-precondition",
        "reCAPTCHA verification unavailable",
        { code: "recaptcha-config-error" }
      );
    }
    if (!recaptchaResult.success) {
      // recaptchaResult.score 可能為 null（例如 invalid-input-secret / invalid-input-response）。
      // 用 structure 化資訊把根因丟給前端/Log，避免一律被誤判為 low-score-robot。
      throw new HttpsError("failed-precondition", "reCAPTCHA verification failed", {
        code: "recaptcha-verify-failed",
        recaptchaScore: recaptchaResult.score,
        recaptchaError: recaptchaResult.raw?.error ?? null,
        // Google 回傳 invalid-input-secret / invalid-input-response 時，錯誤碼在 error-codes
        recaptchaErrorCode:
          (Array.isArray(recaptchaResult.raw?.["error-codes"]) ? recaptchaResult.raw["error-codes"][0] : null) ??
          null,
        recaptchaAction: recaptchaResult.action ?? null,
      });
    }
  }

  const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}`);
  const voteRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}/votes/${deviceIdStr}`);
  const profileBreakingRef = db.doc(`profiles/${uid}/breaking_votes/${eventIdStr}`);

  let debug = null;
  try {
    await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new HttpsError("not-found", "Event not found");
      }
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
      const optionClamped =
        optionsLen > 0 ? Math.max(0, Math.min(Math.floor(Number(option)), optionsLen - 1)) : 0;
      tx.set(voteRef, {
        optionIndex: optionClamped,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(profileBreakingRef, {
        optionIndex: optionClamped,
        deviceId: deviceIdStr,
        eventId: eventIdStr,
        createdAt: FieldValue.serverTimestamp(),
      });
      // 突發戰區 Vote-to-Reveal：同一 Transaction 內更新活動文件的票數統計，供前端投票後顯示結果條
      const existingVoteCounts = eventSnap.data()?.vote_counts;
      const voteCountsIsMapLike =
        existingVoteCounts && typeof existingVoteCounts === "object" && !Array.isArray(existingVoteCounts);

      // 先用 set(merge) 確保必要結構存在，避免後續 update 因型別不符或缺欄位而失敗。
      if (!voteCountsIsMapLike) {
        tx.set(
          eventRef,
          {
            vote_counts: {},
            total_votes: 0,
          },
          { merge: true }
        );
      }

      const voteCountPath = `vote_counts.${optionClamped}`;
      tx.update(eventRef, {
        [voteCountPath]: FieldValue.increment(1),
        total_votes: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

      debug = { eventId: eventIdStr, optionClamped, voteCountPath };
    });

    // 附帶回傳寫入後的統計（多 1 次 read）
    const afterSnap = await eventRef.get();
    const afterData = afterSnap.exists ? afterSnap.data() : null;
    const totalVotes = typeof afterData?.total_votes === "number" ? afterData.total_votes : 0;
    const voteCounts =
      afterData?.vote_counts && typeof afterData.vote_counts === "object" ? afterData.vote_counts : {};

    return { ok: true, debug, total_votes: totalVotes, vote_counts: voteCounts };
  } catch (txnErr) {
    if (txnErr instanceof HttpsError) {
      throw txnErr;
    }
    functions.logger.error("[submitBreakingVote][transaction]", {
      message: txnErr?.message,
      code: txnErr?.code,
      eventId: eventIdStr,
      deviceId: deviceIdStr,
    });
    throw new HttpsError(
      "failed-precondition",
      "Breaking vote transaction failed",
      { code: "breaking-transaction-failed", detail: txnErr?.message }
    );
  }
}

/**
 * issueAdRewardToken — 簽發廣告獎勵 Token（看完廣告後由前端呼叫）。
 *
 * 設計意圖：當未使用 AD_REWARD_VERIFY_ENDPOINT 時，改由後端以 AD_REWARD_SIGNING_SECRET 簽發短期 Token，
 * 前端於「廣告觀看完成」後呼叫此函式取得 Token，再傳入 resetPosition。僅限已登入使用者，且 Token 5 分鐘有效。
 */
export const issueAdRewardToken = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);

  const placement =
    typeof request.data?.placement === "string" ? request.data.placement.trim() : "reset_position";

  try {
    const token = signAdRewardToken({
      placement,
      uid: request.auth.uid,
    });
    return { token };
  } catch (err) {
    // 不將內部錯誤訊息（如 Secret 未設定）回傳給客戶端，避免資訊洩漏
    console.error("[issueAdRewardToken]", err?.message);
    throw new HttpsError("internal", "Failed to issue ad reward token", {
      code: "ad-reward-issue-failed",
    });
  }
});

/**
 * getFilteredSentimentSummary — 漏斗篩選後之情緒聚合（Admin 讀 votes，客戶端 Rules 已禁止掃描）。
 * 與原 useSentimentData 查詢語意對齊：starId + 可選 team/ageGroup/gender/country/city。
 */
export const getFilteredSentimentSummary = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);

  const payload = request.data || {};
  const starIdRaw = typeof payload.starId === "string" ? payload.starId.trim() : "";
  const starId = starIdRaw || STAR_ID;

  let pageSize = Number(payload.pageSize);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 200;
  pageSize = Math.min(Math.floor(pageSize), 500);

  const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
  const fieldMap = {
    team: "voterTeam",
    ageGroup: "ageGroup",
    gender: "gender",
    country: "country",
    city: "city",
  };

  let q = db.collection("votes").where("starId", "==", starId);
  for (const [key, fieldName] of Object.entries(fieldMap)) {
    const v = filters[key];
    if (v != null && String(v).trim() !== "") {
      q = q.where(fieldName, "==", String(v).trim());
    }
  }
  q = q.limit(pageSize);

  try {
    const snap = await q.get();
    const rows = snap.docs.map((d) => {
      const row = d.data() || {};
      return { id: d.id, ...row };
    });
    const summary = computeSentimentSummaryFromRows(rows);
    return {
      ok: true,
      summary,
      rows,
      rowCount: rows.length,
      truncated: snap.size >= pageSize,
    };
  } catch (err) {
    console.error("[getFilteredSentimentSummary]", err?.message);
    throw new HttpsError("internal", "Filtered sentiment query failed", {
      code: "filtered-sentiment-internal",
    });
  }
});

