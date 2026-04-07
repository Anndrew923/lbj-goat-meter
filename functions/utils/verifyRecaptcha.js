// utils/verifyRecaptcha.js
// 設計意圖：
// - 將 reCAPTCHA 驗證集中於單一模組；目前僅 submitVote 使用（minScore 0.5），resetPosition 不看分數、不呼叫本模組。
// - 透過 Secret Manager（或等價的環境變數注入）管理後端密鑰，前端永不暴露 secret。

import fetch from "node-fetch";

const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

/** 同一冷啟內快取，避免每次 siteverify 重複讀環境變數（輪替後新部署新程序）。 */
let cachedRecaptchaSecret = null;

/**
 * 從環境變數讀取 reCAPTCHA secret。
 * 推薦做法：在 GCP / Firebase 中將 Secret Manager 綁定到 RECAPTCHA_SECRET 環境變數。
 */
function getRecaptchaSecret() {
  if (cachedRecaptchaSecret) return cachedRecaptchaSecret;
  const secret = typeof process.env.RECAPTCHA_SECRET === "string" ? process.env.RECAPTCHA_SECRET.trim() : "";
  if (!secret) {
    throw new Error(
      "[verifyRecaptcha] Missing RECAPTCHA_SECRET. Please bind Secret Manager secret to RECAPTCHA_SECRET env."
    );
  }
  cachedRecaptchaSecret = secret;
  return secret;
}

/**
 * 驗證 reCAPTCHA Token（支援 v2 / v3）；僅 submitVote 使用 minScore 保護投票數據，resetPosition 不看分數。
 *
 * @param {string} token - 從前端取得的 reCAPTCHA token
 * @param {object} [options]
 * @param {number} [options.minScore=0] - 最低通過分數（v3 專用；僅 submitVote 使用 0.5 保護投票數據；resetPosition 不看分數）
 * @param {string | null} [options.remoteIp=null] - 可選：用戶 IP，用於更嚴格的驗證
 * @returns {Promise<{ success: boolean, score: number | null, action?: string, raw: any }>}
 */
export async function verifyRecaptcha(token, { minScore = 0, remoteIp = null } = {}) {
  if (typeof token !== "string" || !token.trim()) {
    return { success: false, score: null, raw: { error: "empty-token" } };
  }

  const secret = getRecaptchaSecret();

  const params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", token.trim());
  if (remoteIp) params.append("remoteip", remoteIp);

  let json;
  try {
    const res = await fetch(RECAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    json = await res.json();
  } catch (err) {
    return {
      success: false,
      score: null,
      raw: { error: "network-error", message: err?.message },
    };
  }

  const success = json?.success === true;
  const score = typeof json?.score === "number" ? json.score : null;

  if (!success) {
    // Google 回傳不一定有 `error` 字段，實際錯誤在 `error-codes`。
    const errorCodes = Array.isArray(json?.["error-codes"]) ? json["error-codes"] : null;
    return { success: false, score, action: json?.action, raw: json, errorCodes };
  }

  if (score != null && score < minScore) {
    const errorCodes = Array.isArray(json?.["error-codes"]) ? json["error-codes"] : null;
    return { success: false, score, action: json?.action, raw: json, errorCodes };
  }

  return { success: true, score, action: json?.action, raw: json };
}

