// utils/verifyAdRewardToken.js
// 設計意圖：
// - 將「看完廣告才可重置立場」的後端驗證集中管理，避免在 Cloud Function 內寫死廣告供應商細節。
// - 實際驗證邏輯可透過環境變數切換為不同供應商的 HTTP Webhook / 簽章檢查。

import fetch from "node-fetch";

/**
 * 驗證廣告獎勵 Token。
 *
 * 建議配置：
 * - 將廣告供應商後端驗證 URL 設定在 AD_REWARD_VERIFY_ENDPOINT 環境變數。
 * - 如需額外簽章（例如 HMAC secret），可再加上 AD_REWARD_VERIFY_SECRET 並於此模組內使用。
 *
 * @param {string} token - 前端傳入的獎勵 Token（例如廣告 SDK callback 取得的 reward token）
 * @returns {Promise<{ success: boolean, raw: any }>}
 */
export async function verifyAdRewardToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    return { success: false, raw: { error: "empty-token" } };
  }

  const endpoint = process.env.AD_REWARD_VERIFY_ENDPOINT;
  if (!endpoint) {
    // 預設行為：若尚未接上真正的供應商 Webhook，視為驗證失敗，避免錯誤放行。
    return {
      success: false,
      raw: { error: "missing-endpoint", message: "AD_REWARD_VERIFY_ENDPOINT not configured" },
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(() => ({}));

    const ok = res.ok && json?.success === true;
    return { success: ok, raw: json };
  } catch (err) {
    return {
      success: false,
      raw: { error: "network-error", message: err?.message },
    };
  }
}

