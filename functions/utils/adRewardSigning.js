/**
 * adRewardSigning — 廣告獎勵 Token 簽發／驗證（Bruce 管控的加密驗證碼機制）
 *
 * 設計意圖：
 * - 當尚未接上 AD_REWARD_VERIFY_ENDPOINT 時，由後端簽發短期有效 Token，前端「看完廣告」後呼叫 issueAdRewardToken 取得。
 * - Token 格式：base64url(payload).base64url(hmac)，payload = { placement, uid, exp }。
 * - 僅後端持有 AD_REWARD_SIGNING_SECRET，前端無法偽造。
 */

import crypto from "crypto";

const PREFIX = "goat_rwd_";
const TTL_SEC = 5 * 60; // 5 分鐘有效

function getSecret() {
  const secret = process.env.AD_REWARD_SIGNING_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("[adRewardSigning] AD_REWARD_SIGNING_SECRET is not set.");
  }
  return secret.trim();
}

/**
 * 簽發廣告獎勵 Token（僅供 issueAdRewardToken 使用）。
 * @param {{ placement: string, uid: string }} payload
 * @returns {string} token
 */
export function signAdRewardToken(payload) {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const data = { ...payload, exp };
  const payloadB64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const hmac = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return PREFIX + payloadB64 + "." + hmac;
}

/**
 * 驗證我們自己簽發的 Token。
 * @param {string} token
 * @returns {{ valid: boolean, payload?: { placement: string, uid: string } }}
 */
export function verifySignedAdRewardToken(token) {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) {
    return { valid: false };
  }
  try {
    const secret = getSecret();
    const rest = token.slice(PREFIX.length);
    const dot = rest.indexOf(".");
    if (dot <= 0) return { valid: false };
    const payloadB64 = rest.slice(0, dot);
    const sig = rest.slice(dot + 1);
    const expectedHmac = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
    // 使用 timing-safe 比較，避免簽章猜測的時序攻擊
    if (sig.length !== expectedHmac.length) return { valid: false };
    const sigBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedHmac, "utf8");
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return { valid: false };
    const raw = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (typeof raw.exp !== "number" || raw.exp < now) return { valid: false };
    if (typeof raw.placement !== "string" || typeof raw.uid !== "string") return { valid: false };
    return { valid: true, payload: { placement: raw.placement, uid: raw.uid } };
  } catch {
    return { valid: false };
  }
}
