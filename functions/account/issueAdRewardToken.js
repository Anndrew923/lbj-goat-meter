/**
 * account/issueAdRewardToken.js — 簽發廣告獎勵 Token
 *
 * 設計意圖：
 * - 前端在原生 AdMob 廣告「觀看完成」回調後立即呼叫此 Callable，取得短效 Token（5 分鐘有效）。
 * - Token 由 AD_REWARD_SIGNING_SECRET 自簽（HMAC），resetPosition 驗證時比對 uid 與 placement，
 *   防止 Token 被他人轉用或重放。
 * - 與 verifyAdRewardToken 的職責分離：簽發在此，驗證在 resetPosition，保持單一職責。
 * - 不向客戶端回傳 Secret 缺失的內部細節，僅記錄至 Cloud Logging，避免資訊洩漏。
 */
import * as functions from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_HTTP_OPTS } from "../shared/constants.js";
import { adRewardSigningSecret } from "../shared/secrets.js";
import { resolveAdRewardSigningSecret } from "../shared/secretResolver.js";
import { requireAuth } from "../shared/security.js";
import { signAdRewardToken } from "../utils/adRewardSigning.js";

export const issueAdRewardToken = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [adRewardSigningSecret] },
  async (request) => {
    requireAuth(request);

    const placement =
      typeof request.data?.placement === "string" ? request.data.placement.trim() : "reset_position";

    const signingSecret = resolveAdRewardSigningSecret(adRewardSigningSecret);
    if (!signingSecret) {
      functions.logger.error("[issueAdRewardToken] AD_REWARD_SIGNING_SECRET is empty after resolve");
      throw new HttpsError("failed-precondition", "Ad reward signing not configured", {
        code: "ad-reward-signing-missing",
      });
    }

    try {
      const token = signAdRewardToken({ placement, uid: request.auth.uid }, signingSecret);
      return { token };
    } catch (err) {
      console.error("[issueAdRewardToken]", err?.message);
      throw new HttpsError("internal", "Failed to issue ad reward token", {
        code: "ad-reward-issue-failed",
      });
    }
  }
);
