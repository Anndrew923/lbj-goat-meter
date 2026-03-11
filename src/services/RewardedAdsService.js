/**
 * RewardedAdsService — 獎勵廣告封裝（重置立場用）
 *
 * 設計意圖：
 * - 原生 (Capacitor)：使用 @capacitor-community/admob 的 prepareRewardVideoAd + showRewardVideoAd，觀看完成後向後端取得簽章 Token。
 * - Web：若 host 注入 window.goatRewardedAds.showAd()，則使用該 SDK 後同樣向後端取得 Token；正式網域無 SDK 時不提供模擬，直接拋錯。
 * - 一律以後端 issueAdRewardToken 簽發之 Token 作為 resetPosition 的 adRewardToken，確保驗證邏輯集中於後端。
 */

import { Capacitor } from "@capacitor/core";
import { AdMob } from "@capacitor-community/admob";
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../lib/firebase";

const PLACEMENT_RESET_POSITION = "reset_position";

// Google 官方獎勵廣告測試單元 ID（與 AdMobService 測試策略一致）
const GOOGLE_TEST_REWARDED_VIDEO_ID = "ca-app-pub-3940256099942544/5224354917";

function isNative() {
  return Capacitor.isNativePlatform();
}

function getRewardedVideoAdId() {
  const id = import.meta.env.VITE_ADMOB_REWARDED_VIDEO_ID;
  return id && String(id).trim() ? id : GOOGLE_TEST_REWARDED_VIDEO_ID;
}

function useTestRewardedAd() {
  const useTest = import.meta.env.VITE_ADMOB_USE_TEST_IDS === "true";
  const hasProdId = Boolean(import.meta.env.VITE_ADMOB_REWARDED_VIDEO_ID?.trim());
  return useTest || !hasProdId;
}

/**
 * 向後端取得廣告獎勵 Token（看完廣告後呼叫，需已登入）。
 * @returns {Promise<string>} 供 resetPosition 使用的 adRewardToken
 */
async function fetchAdRewardTokenFromBackend() {
  const functions = getFunctions(app);
  const callable = httpsCallable(functions, "issueAdRewardToken");
  const result = await callable({ placement: PLACEMENT_RESET_POSITION });
  const token = result?.data?.token;
  if (typeof token !== "string" || !token) {
    throw new Error("Backend did not return ad reward token");
  }
  return token;
}

/**
 * 原生平台：播放 AdMob 獎勵廣告，成功後向後端取得 Token。
 * @returns {Promise<string>}
 */
async function showNativeRewardedAd() {
  const adId = getRewardedVideoAdId();
  const isTesting = useTestRewardedAd();

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

  return fetchAdRewardTokenFromBackend();
}

/**
 * 顯示重置立場用的 Rewarded Ad，並在成功完整觀看後回傳 adRewardToken。
 *
 * - 原生：AdMob 獎勵影片 → 後端 issueAdRewardToken。
 * - Web：若存在 window.goatRewardedAds.showAd，則呼叫後再向後端取得 Token；僅 localhost 開發時允許無 SDK 模擬。
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
      return await showNativeRewardedAd();
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
        return fetchAdRewardTokenFromBackend();
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

  // 無 SDK：僅 localhost 開發時允許佔位 Token（後端 shouldBypassHardSecurity 會略過廣告驗證）
  if (import.meta.env.DEV) {
    const origin = window.location?.origin || "";
    const isLocal = /localhost|127\.0\.0\.1/.test(origin);
    if (isLocal) {
      console.warn(
        "[RewardedAdsService] Web 無 goatRewardedAds，localhost 使用佔位 Token（後端 bypass 會放行）。"
      );
      return "dev-bypass-localhost";
    }
  }

  const err = new Error("Rewarded ads SDK not available");
  err.code = "ad-not-watched";
  throw err;
}
