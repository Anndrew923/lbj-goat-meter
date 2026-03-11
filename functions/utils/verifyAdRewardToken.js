// utils/verifyAdRewardToken.js
// 設計意圖：
// - 將「看完廣告才可重置立場」的後端驗證集中管理。
// - 雙軌：1) 自簽 Token（AD_REWARD_SIGNING_SECRET）由 issueAdRewardToken 簽發；2) 外部 API（AD_REWARD_VERIFY_ENDPOINT）接廣告供應商 Webhook。

import fetch from "node-fetch";
import { verifySignedAdRewardToken } from "./adRewardSigning.js";

const INTERNAL_PREFIX = "goat_rwd_";

/**
 * 驗證廣告獎勵 Token。
 * - 若 token 為自簽格式（goat_rwd_...），以 AD_REWARD_SIGNING_SECRET 驗證簽章與時效。
 * - 否則若已設定 AD_REWARD_VERIFY_ENDPOINT，則轉發至該 API 驗證。
 *
 * @param {string} token - 前端傳入的獎勵 Token
 * @returns {Promise<{ success: boolean, raw: any }>}
 */
export async function verifyAdRewardToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    return { success: false, raw: { error: "empty-token" } };
  }

  const trimmed = token.trim();

  // 自簽 Token：由 issueAdRewardToken 簽發，僅後端可驗證
  if (trimmed.startsWith(INTERNAL_PREFIX)) {
    const result = verifySignedAdRewardToken(trimmed);
    return {
      success: result.valid,
      raw: result.valid ? { source: "signed", payload: result.payload } : { error: "invalid-signature-or-expired" },
    };
  }

  // 外部 API：供應商 Webhook 驗證
  const endpoint = process.env.AD_REWARD_VERIFY_ENDPOINT;
  if (!endpoint) {
    return {
      success: false,
      raw: { error: "missing-endpoint", message: "AD_REWARD_VERIFY_ENDPOINT not configured" },
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: trimmed }),
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
