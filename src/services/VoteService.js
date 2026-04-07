/**
 * VoteService — 投票／撤票／聚合核心引擎
 *
 * 設計意圖：
 * - 早期版本：所有投票與撤票的 Firestore Transaction 集中於此，直接由前端呼叫 runTransaction。
 * - 現行版本：改由 Cloud Functions 作為唯一寫入入口（Admin SDK Transaction），
 *   前端僅負責呼叫 httpsCallable 並處理 reCAPTCHA 與錯誤映射，維持原有純函數聚合接口不變。
 * - computeGlobalDeductions / computeWarzoneDeltas 仍供 deleteAccountData 等流程複用減法邏輯。
 */

import { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import app, { getFirebaseFunctions } from "../lib/firebase";
import i18n from "../i18n/config";
import { STANCE_KEYS, PRO_STANCES, ANTI_STANCES, getInitialGlobalSummary } from "../lib/constants";
import { isObject } from "../utils/typeUtils";
import { getRecaptchaToken } from "./RecaptchaService";
import { createGoldenKeySignature, GOLDEN_KEY_ACTIONS } from "./GoldenKeyService";
import { normalizeBreakingOptionIndex } from "../utils/normalizeBreakingOptionIndex";
import { trackSubmitVote } from "./MetaAnalyticsService";

function getFunctionsInstance() {
  if (!app) {
    throw new Error(
      "[VoteService] Firebase app is not initialized. Check environment variables (.env) before submitting votes."
    );
  }
  const fns = getFirebaseFunctions();
  if (!fns) {
    throw new Error(
      "[VoteService] Firebase Functions 未初始化。請確認於瀏覽器環境執行，且 VITE_FIREBASE_FUNCTIONS_REGION 與後端部署區一致。"
    );
  }
  return fns;
}
const STAR_ID = "lbj";

function getVoteFunctionErrorMessage(err, getMessage) {
  const backendCode = err?.details?.code ?? err?.customData?.code;
  const recaptchaErrFromDetails =
    err?.details?.recaptchaError ?? err?.customData?.recaptchaError;

  if (backendCode === "auth-required") {
    return getMessage("common:voteError_authRequired");
  }
  if (backendCode === "low-score-robot") {
    if (import.meta.env.DEV && typeof err?.details?.recaptchaScore === "number") {
      // 開發模式：輸出 reCAPTCHA 分數，方便調整門檻與稽查。
      console.log(
        "[VoteService] reCAPTCHA score (backend):",
        err.details.recaptchaScore
      );
    }
    return getMessage("common:voteError_lowScoreRobot");
  }
  if (backendCode === "device-already-voted") {
    return getMessage("common:voteError_deviceAlreadyVoted");
  }
  if (backendCode === "fingerprint-recent-vote") {
    return getMessage("common:voteError_fingerprintRecentVote");
  }
  if (backendCode === "ad-not-watched") {
    return getMessage("common:voteError_adNotWatched");
  }
  if (backendCode === "vote-internal") {
    return getMessage("common:voteError_voteInternal");
  }
  if (backendCode === "rate-limit-exceeded") {
    return getMessage("common:voteError_rateLimitExceeded");
  }
  if (backendCode === "recaptcha-greyzone-requires-challenge") {
    return getMessage("common:voteError_recaptchaGreyZone");
  }
  if (backendCode === "recaptcha-config-error") {
    return getMessage("common:voteError_recaptchaConfig");
  }
  if (backendCode === "recaptcha-verify-failed") {
    if (recaptchaErrFromDetails === "empty-token" || recaptchaErrFromDetails == null) {
      return getMessage("common:voteError_recaptchaEmptyToken");
    }
    return getMessage("common:voteError_recaptchaVerifyFailed");
  }

  const fallback =
    (err?.message && typeof err.message === "string" && err.message) ||
    getMessage("common:submitError");
  return fallback;
}

/**
 * 突發戰區投票：一話題一設備一票，需帶入 deviceId 與 recaptchaToken。
 *
 * @param {string} eventId - global_events 文件 ID
 * @param {number} optionIndex - 選項索引（0-based）
 * @param {string} deviceId - 設備識別碼（getDeviceId()）
 * @param {string | null} recaptchaToken - RecaptchaService.getRecaptchaToken('submit_breaking_vote')
 * @param {(key: string) => string} getMessage - i18n 鍵→文案
 * @param {string | null} [adRewardToken=null] - 若需經過獎勵廣告授權，前置流程取得的 adRewardToken
 */
export async function submitBreakingVote(
  eventId,
  optionIndex,
  deviceId,
  recaptchaToken,
  getMessage,
  adRewardToken = null
) {
  if (typeof getMessage !== "function") throw new Error("getMessage is required");
  const eventIdStr = typeof eventId === "string" ? eventId.trim() : "";
  if (!eventIdStr) throw new Error(getMessage("common:breakingVoteError"));
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!deviceIdStr) throw new Error(getMessage("common:error_deviceIdRequired"));

  const optionNorm = normalizeBreakingOptionIndex(optionIndex);
  const tokenStr = typeof recaptchaToken === "string" ? recaptchaToken.trim() : "";
  if (!tokenStr) {
    throw new Error(getMessage("common:voteError_recaptchaEmptyToken"));
  }

  const payload = {
    eventId: eventIdStr,
    optionIndex: optionNorm,
    deviceId: deviceIdStr,
    recaptchaToken: tokenStr,
    adRewardToken: adRewardToken ?? null,
  };

  const { xGoatTimestamp, xGoatSignature } = await createGoldenKeySignature(
    GOLDEN_KEY_ACTIONS.SUBMIT_BREAKING_VOTE,
    {
      eventId: eventIdStr,
      deviceId: deviceIdStr,
      optionIndex: optionNorm,
    }
  );

  const functions = getFunctionsInstance();
  const callable = httpsCallable(functions, "submitBreakingVote");
  try {
    await callable({
      ...payload,
      xGoatTimestamp,
      xGoatSignature,
    });
  } catch (err) {
    const code = err?.details?.code || err?.code;
    if (code === "breaking-already-voted") {
      throw new Error(getMessage("common:breakingAlreadyVoted"));
    }
    if (code === "low-score-robot") {
      throw new Error(getMessage("common:voteError_lowScoreRobot"));
    }
    if (code === "unauthenticated" || code === "auth-required") {
      throw new Error(getMessage("common:voteError_authRequired"));
    }
    if (
      code === "signature-mismatch" ||
      code === "signature-missing" ||
      code === "signature-invalid-timestamp" ||
      code === "signature-timestamp-skew"
    ) {
      throw new Error(getMessage("common:breakingVoteSignatureError"));
    }
    if (code === "breaking-transaction-failed" || code === "recaptcha-config-error") {
      throw new Error(getMessage("common:breakingVoteError"));
    }
    if (code === "rate-limit-exceeded") {
      throw new Error(getMessage("common:voteError_rateLimitExceeded"));
    }
    if (code === "recaptcha-greyzone-requires-challenge") {
      throw new Error(getMessage("common:voteError_recaptchaGreyZone"));
    }
    if (code === "recaptcha-verify-failed") {
      const recaptchaErr = err?.details?.recaptchaError ?? err?.customData?.recaptchaError;
      if (recaptchaErr === "empty-token" || recaptchaErr == null) {
        throw new Error(getMessage("common:voteError_recaptchaEmptyToken"));
      }
      throw new Error(getMessage("common:voteError_recaptchaVerifyFailed"));
    }
    const msg = (err?.message && typeof err.message === "string" && err.message) || getMessage("common:breakingVoteError");
    throw new Error(msg);
  }
}

/**
 * 提交一票（含設備鎖：一設備一票，與 revokeVote / deleteAccountData 連動解鎖）。
 *
 * @param {string} userId - Firebase Auth UID
 * @param {{ selectedStance: string, selectedReasons: string[], deviceId?: string }} payload - 立場、理由、設備識別碼（必填，用於 device_locks）
 * @param {(key: string) => string} getMessage - i18n 鍵→文案，例：(key) => t(key)
 * @throws 若 device_locks/${deviceId} 已存在且 active === true，拋出 error_deviceAlreadyVoted
 */
export async function submitVote(userId, { selectedStance, selectedReasons, deviceId }, getMessage) {
  if (typeof getMessage !== "function") throw new Error("getMessage is required");
  if (!userId) throw new Error(getMessage("common:error_missingDbOrUid"));
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!deviceIdStr) throw new Error(getMessage("common:error_deviceIdRequired"));

  // 僅在「即將送出」時取得最新 reCAPTCHA token，確保有效期限內。
  const recaptchaToken = await getRecaptchaToken("submit_vote");
  const tokenStr = typeof recaptchaToken === "string" ? recaptchaToken.trim() : "";
  if (!tokenStr) {
    throw new Error(getMessage("common:voteError_recaptchaEmptyToken"));
  }

  const payload = {
    voteData: { selectedStance, selectedReasons, deviceId: deviceIdStr },
    recaptchaToken: tokenStr,
  };

  const { xGoatTimestamp, xGoatSignature } = await createGoldenKeySignature(
    GOLDEN_KEY_ACTIONS.SUBMIT_VOTE,
    {
      uid: userId,
      deviceId: deviceIdStr,
      selectedStance,
    }
  );

  const functions = getFunctionsInstance();
  const submitCallable = httpsCallable(functions, "submitVote");

  try {
    const result = await submitCallable({
      ...payload,
      xGoatTimestamp,
      xGoatSignature,
    });
    if (import.meta.env.DEV && result?.data?.recaptchaScore != null) {
      console.log(
        "[VoteService] submitVote reCAPTCHA score (backend):",
        result.data.recaptchaScore
      );
    }
    await trackSubmitVote({
      starId: STAR_ID,
      stance: selectedStance,
      warzoneId: result?.data?.warzoneId ?? null,
      reasonCount: Array.isArray(selectedReasons) ? selectedReasons.length : 0,
    });
  } catch (err) {
    const message = getVoteFunctionErrorMessage(err, getMessage);
    throw new Error(message);
  }
}

/**
 * 純函數：依現有 global 與多筆 vote 計算扣減後的 global 欄位（不含 recentVotes、updatedAt）。
 * 若 globalData 為 null/undefined 則以 getInitialGlobalSummary() 為底。
 *
 * @param {Record<string, unknown> | null | undefined} globalData - global_summary 的 data()
 * @param {{ id: string, data: Record<string, unknown> }[]} voteDataList
 * @returns {Record<string, unknown>} 可寫入 global_summary 的 payload（由呼叫端加上 updatedAt）
 */
export function computeGlobalDeductions(globalData, voteDataList) {
  if (globalData == null || typeof globalData !== "object") {
    globalData = getInitialGlobalSummary();
  }
  const hasValidVotes = voteDataList.some((v) => v.data?.status && STANCE_KEYS.includes(v.data.status));
  if (voteDataList.length === 0 || !hasValidVotes) {
    return {
      totalVotes: typeof globalData.totalVotes === "number" ? globalData.totalVotes : 0,
      ...Object.fromEntries(STANCE_KEYS.map((k) => [k, typeof globalData[k] === "number" ? globalData[k] : 0])),
      reasonCountsLike: isObject(globalData.reasonCountsLike) ? globalData.reasonCountsLike : {},
      reasonCountsDislike: isObject(globalData.reasonCountsDislike) ? globalData.reasonCountsDislike : {},
      countryCounts: isObject(globalData.countryCounts) ? globalData.countryCounts : {},
    };
  }

  let newTotal = typeof globalData.totalVotes === "number" ? globalData.totalVotes : 0;
  const stanceCounts = {};
  STANCE_KEYS.forEach((key) => {
    stanceCounts[key] = typeof globalData[key] === "number" ? globalData[key] : 0;
  });
  const reasonCountsLike = { ...(isObject(globalData.reasonCountsLike) ? globalData.reasonCountsLike : {}) };
  const reasonCountsDislike = { ...(isObject(globalData.reasonCountsDislike) ? globalData.reasonCountsDislike : {}) };
  const countryCounts = { ...(isObject(globalData.countryCounts) ? globalData.countryCounts : {}) };

  for (const { data: voteData } of voteDataList) {
    const status = voteData?.status;
    if (!status || !STANCE_KEYS.includes(status)) continue;
    newTotal = Math.max(0, newTotal - 1);
    STANCE_KEYS.forEach((key) => {
      stanceCounts[key] = key === status ? Math.max(0, (stanceCounts[key] ?? 0) - 1) : (stanceCounts[key] ?? 0);
    });
    (voteData.reasons || []).forEach((r) => {
      if (PRO_STANCES.has(status)) {
        reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) - 1;
        if (reasonCountsLike[r] <= 0) delete reasonCountsLike[r];
      } else if (ANTI_STANCES.has(status)) {
        reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) - 1;
        if (reasonCountsDislike[r] <= 0) delete reasonCountsDislike[r];
      }
    });
    const cc = String(voteData.country ?? "").toUpperCase().slice(0, 2);
    if (cc && countryCounts[cc]) {
      const cur = countryCounts[cc];
      const pro = Math.max(0, (cur.pro ?? 0) - (PRO_STANCES.has(status) ? 1 : 0));
      const anti = Math.max(0, (cur.anti ?? 0) - (ANTI_STANCES.has(status) ? 1 : 0));
      if (pro > 0 || anti > 0) countryCounts[cc] = { pro, anti };
      else delete countryCounts[cc];
    }
  }

  return {
    totalVotes: newTotal,
    ...stanceCounts,
    reasonCountsLike,
    reasonCountsDislike,
    countryCounts,
  };
}

/**
 * 純函數：依多筆 vote 計算各 warzoneId 的扣減量（負數），供 deleteAccountData 以 increment 寫入 warzoneStats。
 *
 * @param {{ id: string, data: Record<string, unknown> }[]} voteDataList
 * @returns {Record<string, { totalVotes: number, [key: string]: number }>} { [warzoneId]: { totalVotes: -n, goat?: -x, ... } }
 */
export function computeWarzoneDeltas(voteDataList) {
  const warzoneDeltas = {};
  for (const { data: voteData } of voteDataList) {
    const status = voteData?.status;
    if (!status || !STANCE_KEYS.includes(status)) continue;
    if (voteData?.hadWarzoneStats !== true) continue;
    const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
    if (!wid) continue;
    if (!warzoneDeltas[wid]) warzoneDeltas[wid] = { totalVotes: 0 };
    warzoneDeltas[wid].totalVotes -= 1;
    warzoneDeltas[wid][status] = (warzoneDeltas[wid][status] ?? 0) - 1;
  }
  return warzoneDeltas;
}
