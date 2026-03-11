/**
 * RewardedAdsService — Google H5 Rewarded Ads 封裝
 *
 * 設計意圖：
 * - 將「看完廣告取得獎勵 Token」的邏輯集中管理，避免在 Context 或 UI 元件中直接操作 Ad SDK。
 * - 介面假設外部已引入 Google H5 Ads SDK，並在 window.goatRewardedAds 上暴露 showAd()。
 * - 若使用者中途關閉廣告或 SDK 不可用，統一丟出帶有 code = 'ad-not-watched' 的錯誤，方便前端映射。
 */

/**
 * 顯示重置立場用的 Rewarded Ad，並在成功完整觀看後回傳 adRewardToken。
 *
 * 預期 SDK 介面：
 * - window.goatRewardedAds.showAd({ placement: 'reset_position' }):
 *   - resolve: { rewardToken: string } 或直接為 string
 *   - reject: error 物件，可選 error.code = 'user-cancel' / 'no-fill' 等
 *
 * @returns {Promise<string>} adRewardToken
 */
export async function requestResetAdRewardToken() {
  if (typeof window === "undefined") {
    const err = new Error("Rewarded ads not available in this environment");
    err.code = "ad-not-watched";
    throw err;
  }

  const sdk = window.goatRewardedAds;

  // 開發模式下，若尚未整合 SDK，允許使用模擬 token 以便端到端測試；正式環境一律視為未觀看。
  if (!sdk || typeof sdk.showAd !== "function") {
    if (import.meta.env.DEV) {
      console.warn(
        "[RewardedAdsService] window.goatRewardedAds.showAd 不存在，使用模擬 adRewardToken。"
      );
      return "dev-simulated-reset-token";
    }
    const err = new Error("Rewarded ads SDK not available");
    err.code = "ad-not-watched";
    throw err;
  }

  try {
    const result = await sdk.showAd({ placement: "reset_position" });
    const token =
      typeof result === "string"
        ? result
        : typeof result?.rewardToken === "string"
          ? result.rewardToken
          : null;

    if (!token) {
      const err = new Error("Reward not granted");
      err.code = "ad-not-watched";
      throw err;
    }

    return token;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (!e.code) {
      e.code = "ad-not-watched";
    }
    if (import.meta.env.DEV) {
      console.warn(
        "[RewardedAdsService] showAd 失敗或使用者中斷，視為未完整觀看：",
        e.message
      );
    }
    throw e;
  }
}

