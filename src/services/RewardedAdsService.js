/**
 * RewardedAdsService — 獎勵廣告封裝（重置立場用）
 *
 * 設計意圖：
 * - 原生 (Capacitor)：使用 @capacitor-community/admob，觀看完成後向後端 issueAdRewardToken 取得簽章 Token。
 * - Web：若 host 注入 window.goatRewardedAds.showAd()，則使用該 SDK 後向後端取得 Token；正式網域無 SDK 時傳 "web-no-ad-sdk"，
 *   後端 resetPosition 依 ALLOWED_WEB_ORIGIN 驗證 origin 後略過廣告檢查（避免呼叫 issueAdRewardToken 觸發 CORS），仍可完成重置。
 */

import { Capacitor } from "@capacitor/core";
import { AdMob } from "@capacitor-community/admob";
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../lib/firebase";

const PLACEMENT_RESET_POSITION = "reset_position";
const PLACEMENT_BREAKING_VOTE = "breaking_vote";

// Google 官方獎勵廣告測試單元 ID（與 AdMobService 測試策略一致）
const GOOGLE_TEST_REWARDED_VIDEO_ID = "ca-app-pub-3940256099942544/5224354917";

function isNative() {
  return Capacitor.isNativePlatform();
}

function getRewardedVideoAdId() {
  const id = import.meta.env.VITE_ADMOB_REWARDED_VIDEO_ID;
  return id && String(id).trim() ? id : GOOGLE_TEST_REWARDED_VIDEO_ID;
}

/** 是否使用測試用廣告單元 ID（非 React Hook，僅讀取 env） */
function shouldUseTestRewardedIds() {
  const useTest = import.meta.env.VITE_ADMOB_USE_TEST_IDS === "true";
  const hasProdId = Boolean(import.meta.env.VITE_ADMOB_REWARDED_VIDEO_ID?.trim());
  return useTest || !hasProdId;
}

/**
 * 向後端取得廣告獎勵 Token（看完廣告後呼叫，需已登入）。
 * 設計意圖：透過 placement 區分不同使用場景（如 reset_position / breaking_vote），
 * 讓後端可針對來源做風控或配額控管。
 * @param {string} placement - 廣告獎勵使用場域
 * @returns {Promise<string>} 供對應 Cloud Function 使用的 adRewardToken
 */
async function fetchAdRewardTokenFromBackend(placement = PLACEMENT_RESET_POSITION) {
  if (!app) {
    const err = new Error(
      "[RewardedAdsService] Firebase app is not initialized. Cannot request ad reward token."
    );
    err.code = "firebase-not-ready";
    throw err;
  }
  const functions = getFunctions(app);
  const callable = httpsCallable(functions, "issueAdRewardToken");
  const result = await callable({ placement });
  const token = result?.data?.token;
  if (typeof token !== "string" || !token) {
    throw new Error("Backend did not return ad reward token");
  }
  return token;
}

/**
 * 原生平台：播放 AdMob 獎勵廣告，成功後向後端取得 Token。
 * @param {string} placement - 對應後端 placement（預設重置立場）
 * @returns {Promise<string>}
 */
async function showNativeRewardedAd(placement = PLACEMENT_RESET_POSITION) {
  const adId = getRewardedVideoAdId();
  const isTesting = shouldUseTestRewardedIds();

  await AdMob.prepareRewardVideoAd({
    adId,
    isTesting,
  });

  const reward = await AdMob.showRewardVideoAd();
  if (!reward || (typeof reward.amount !== "number" && !reward.type)) {
    const err = new Error("Reward not granted");
    err.code = "ad-not-watched";
    throw err;
  }

  return fetchAdRewardTokenFromBackend(placement);
}

/**
 * 顯示重置立場用的 Rewarded Ad，並在成功完整觀看後回傳 adRewardToken。
 *
 * - 原生：AdMob 獎勵影片 → 後端 issueAdRewardToken。
 * - Web：若存在 window.goatRewardedAds.showAd 則先播廣告再取 Token；無 SDK 時 localhost 用佔位、正式網域傳 "web-no-ad-sdk"（後端依 origin 放行）。
 *
 * @returns {Promise<string>} adRewardToken（供 resetPosition 使用）
 */
export async function requestResetAdRewardToken() {
  if (typeof window === "undefined") {
    const err = new Error("Rewarded ads not available in this environment");
    err.code = "ad-not-watched";
    throw err;
  }

  // 原生：使用 Capacitor AdMob 獎勵廣告
  if (isNative()) {
    try {
      return await showNativeRewardedAd(PLACEMENT_RESET_POSITION);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (!e.code) e.code = "ad-not-watched";
      throw e;
    }
  }

  // Web：使用 host 注入的 SDK 或開發用模擬
  const sdk = window.goatRewardedAds;

  if (sdk && typeof sdk.showAd === "function") {
    try {
      const result = await sdk.showAd({ placement: PLACEMENT_RESET_POSITION });
      const sdkToken =
        typeof result === "string"
          ? result
          : typeof result?.rewardToken === "string"
            ? result.rewardToken
            : null;

      if (sdkToken) {
        // 若外部 SDK 回傳的已是我們後端格式（goat_rwd_...），可直接使用；否則仍向後端取得統一 Token。
        if (sdkToken.startsWith("goat_rwd_")) return sdkToken;
        return fetchAdRewardTokenFromBackend(PLACEMENT_RESET_POSITION);
      }

      const err = new Error("Reward not granted");
      err.code = "ad-not-watched";
      throw err;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (!e.code) e.code = "ad-not-watched";
      throw e;
    }
  }

  // 無 SDK：localhost 用佔位 Token（後端 bypass）；正式網域網頁版傳 "web-no-ad-sdk"，後端依 origin 放行，不再呼叫 issueAdRewardToken（避免 CORS）
  const origin = window.location?.origin || "";
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  if (import.meta.env.DEV && isLocal) {
    console.warn(
      "[RewardedAdsService] Web 無 goatRewardedAds，localhost 使用佔位 Token（後端 bypass 會放行）。"
    );
    return "dev-bypass-localhost";
  }

  // 正式網域網頁版：無廣告 SDK 時傳送佔位符，後端 resetPosition 在驗證 origin 後略過廣告檢查，不需呼叫 issueAdRewardToken
  console.warn(
    "[RewardedAdsService] Web 無廣告 SDK，使用 web-no-ad-sdk（後端依允許的 origin 放行）。"
  );
  return "web-no-ad-sdk";
}

/**
 * 顯示突發戰區投票用的 Rewarded Ad，並在成功完整觀看後回傳 adRewardToken。
 *
 * 設計意圖：與重置立場共用相同廣告載具與錯誤處理邏輯，但透過 placement = "breaking_vote"
 * 讓後端可針對突發戰區投票行為做獨立的統計與風控。
 *
 * @returns {Promise<string>} adRewardToken（供 submitBreakingVote 使用）
 */
export async function requestBreakingVoteAdRewardToken() {
  if (typeof window === "undefined") {
    const err = new Error("Rewarded ads not available in this environment");
    err.code = "ad-not-watched";
    throw err;
  }

  // 原生：使用 Capacitor AdMob 獎勵廣告
  if (isNative()) {
    try {
      return await showNativeRewardedAd(PLACEMENT_BREAKING_VOTE);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (!e.code) e.code = "ad-not-watched";
      throw e;
    }
  }

  // Web：使用 host 注入的 SDK 或開發用模擬
  const sdk = window.goatRewardedAds;

  if (sdk && typeof sdk.showAd === "function") {
    try {
      const result = await sdk.showAd({ placement: PLACEMENT_BREAKING_VOTE });
      const sdkToken =
        typeof result === "string"
          ? result
          : typeof result?.rewardToken === "string"
            ? result.rewardToken
            : null;

      if (sdkToken) {
        if (sdkToken.startsWith("goat_rwd_")) return sdkToken;
        return fetchAdRewardTokenFromBackend(PLACEMENT_BREAKING_VOTE);
      }

      const err = new Error("Reward not granted");
      err.code = "ad-not-watched";
      throw err;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (!e.code) e.code = "ad-not-watched";
      throw e;
    }
  }

  const origin = window.location?.origin || "";
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  if (import.meta.env.DEV && isLocal) {
    console.warn(
      "[RewardedAdsService] Web 無 goatRewardedAds，localhost 使用突發戰區投票佔位 Token（後端 bypass 會放行）。"
    );
    return "dev-bypass-localhost-breaking-vote";
  }

  console.warn(
    "[RewardedAdsService] Web 無廣告 SDK，突發戰區投票使用 web-no-ad-sdk（後端依允許的 origin 放行）。"
  );
  return "web-no-ad-sdk";
}
