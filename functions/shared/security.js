/**
 * shared/security.js — 身份驗證、限流、reCAPTCHA、安全旁路判斷
 *
 * 設計意圖：
 * - 所有 Callable 的「門口邏輯」集中於此，Feature 模組只關注業務邏輯。
 * - enforceVoteRateLimit 以 Firestore Transaction 實作多維度（uid/ip/fingerprint）限流；
 *   doc ID 在 Transaction 外預先計算，每個 dimension 的 SHA-256 只跑一次。
 * - enforceRecaptcha 抽離 ~50 行重複的 reCAPTCHA 驗證塊，submitVote / submitBreakingVote
 *   共用同一路徑，確保評分門檻與錯誤碼一致，修 bug 不需改兩處。
 * - shouldBypassHardSecurity 需要旗標 + localhost origin 雙重成立，防止旗標被帶入正式環境。
 * - logVoteSecurityEvent 的 null-default normalized 層確保 Log Explorer schema 欄位恆存在；
 *   payload 再覆蓋，null default 不會遮蓋實際值。
 */
import * as functions from "firebase-functions";
import crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue, Timestamp } from "./admin.js";
import {
  HARD_SECURITY_BYPASS_FLAG,
  RATE_LIMIT_COLLECTION,
  RATE_LIMIT_CONFIG,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_TTL_MS,
  LOCAL_RECAPTCHA_DEV_PLACEHOLDER,
  RECAPTCHA_MIN_SCORE,
  RECAPTCHA_GREY_ZONE_MIN,
} from "./constants.js";
import { verifyRecaptcha } from "../utils/verifyRecaptcha.js";

/** 從 x-forwarded-for 或 rawRequest.ip 提取真實 IP（Cloud Run 多層 proxy 時取第一跳）。 */
export function extractClientIp(context) {
  const xff = context.rawRequest?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  const ip = context.rawRequest?.ip;
  return typeof ip === "string" ? ip.trim() : "";
}

/** SHA-256 雜湊限流文件 ID，避免 uid/ip 明文存入 Firestore。 */
function digestRateLimitDocId(scope, dimension, key) {
  return `${scope}_${dimension}_${crypto
    .createHash("sha256")
    .update(`${scope}|${dimension}|${key}`)
    .digest("hex")}`;
}

/**
 * 輸出結構化安全事件日誌；level 對應 functions.logger 方法名（info/warn/error）。
 * null-default normalized 層確保 Log Explorer schema 欄位恆存在；
 * ...payload 在後面覆蓋，讓實際值取代 null default。
 */
export function logVoteSecurityEvent(level, action, phase, payload = {}) {
  const logger = functions.logger[level] || functions.logger.info;
  const normalized = {
    uid: payload.uid ?? null,
    ip: payload.ip ?? null,
    fingerprintHash: payload.fingerprintHash ?? null,
    recaptchaScore: payload.recaptchaScore ?? null,
    eventId: payload.eventId ?? null,
    origin: payload.origin ?? null,
    dimension: payload.dimension ?? null,
    current: payload.current ?? null,
    limit: payload.limit ?? null,
    code: payload.code ?? null,
    minScore: payload.minScore ?? null,
    recaptchaAction: payload.recaptchaAction ?? null,
  };
  logger("[vote-security]", { action, phase, ...normalized, ...payload });
}

/**
 * 多維度限流 Transaction。
 * 設計意圖：doc ID（SHA-256）在 Promise.all 前預計算並快取於 dimensionsWithIds，
 * 每個 dimension 只執行一次雜湊，讀取和寫入均直接使用快取結果。
 */
export async function enforceVoteRateLimit({ action, uid, ip, fingerprintHash }) {
  const cfg = RATE_LIMIT_CONFIG[action];
  if (!cfg) return;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const dimensionsWithIds = [
    { name: "uid", key: uid, limit: cfg.uid },
    { name: "ip", key: ip, limit: cfg.ip },
    { name: "fingerprint", key: fingerprintHash, limit: cfg.fingerprint },
  ]
    .filter((d) => d.key && d.limit > 0)
    .map((d) => ({ ...d, docId: digestRateLimitDocId(action, d.name, d.key) }));

  if (!dimensionsWithIds.length) return;

  await db.runTransaction(async (tx) => {
    const snapshots = await Promise.all(
      dimensionsWithIds.map((d) => tx.get(db.doc(`${RATE_LIMIT_COLLECTION}/${d.docId}`)))
    );

    for (const [idx, dim] of dimensionsWithIds.entries()) {
      const ref = db.doc(`${RATE_LIMIT_COLLECTION}/${dim.docId}`);
      const snap = snapshots[idx];
      const prev = snap.exists ? snap.data() || {} : {};
      const attempts = Array.isArray(prev.attempts)
        ? prev.attempts.filter((ts) => Number.isFinite(ts) && ts >= windowStart)
        : [];

      if (attempts.length >= dim.limit) {
        logVoteSecurityEvent("warn", action, "rate-limit-deny", {
          uid: uid || null, ip: ip || null, fingerprintHash: fingerprintHash || null,
          dimension: dim.name, current: attempts.length, limit: dim.limit,
        });
        throw new HttpsError("resource-exhausted", "Rate limit exceeded", {
          code: "rate-limit-exceeded", action, dimension: dim.name,
          limit: dim.limit, retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
        });
      }

      attempts.push(now);
      tx.set(ref, {
        attempts,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + RATE_LIMIT_TTL_MS),
        action,
        dimension: dim.name,
      }, { merge: true });
    }
  });
}

/**
 * reCAPTCHA v3 驗證（含 localhost dev bypass）。
 *
 * 設計意圖：submitVote / submitBreakingVote 共用此函數，確保評分門檻與錯誤碼只有一份定義。
 * extraLogFields 允許 breaking vote 多帶 eventId 進結構化日誌，不影響通用路徑。
 *
 * @param {object} context - Callable request context（含 rawRequest、recaptchaSecret）
 * @param {string} token - 前端傳入的 reCAPTCHA token
 * @param {{ action: string, uid: string, ip: string, extraLogFields?: object }} opts
 */
export async function enforceRecaptcha(context, token, { action, uid, ip, extraLogFields = {} }) {
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isLocalWebOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const isLocalDevBypass =
    isLocalWebOrigin &&
    typeof token === "string" &&
    token.trim() === LOCAL_RECAPTCHA_DEV_PLACEHOLDER;

  if (isLocalDevBypass) {
    functions.logger.warn(`[${action}] Local web dev: dev-bypass-localhost-recaptcha — skipping reCAPTCHA.`);
    return;
  }

  let recaptchaResult;
  try {
    recaptchaResult = await verifyRecaptcha(token, {
      minScore: 0,
      secretOverride: context.recaptchaSecret || "",
    });
  } catch (err) {
    functions.logger.error(`[${action}][recaptcha-config]`, { message: err?.message, uid });
    throw new HttpsError("failed-precondition", "reCAPTCHA verification unavailable", {
      code: "recaptcha-config-error",
    });
  }

  if (!recaptchaResult.success) {
    logVoteSecurityEvent("warn", action, "recaptcha-fail", {
      uid, ip: ip || null, ...extraLogFields,
      recaptchaScore: recaptchaResult.score,
      recaptchaAction: recaptchaResult.action ?? null,
    });
    const firstErrorCode = Array.isArray(recaptchaResult.raw?.["error-codes"])
      ? recaptchaResult.raw["error-codes"][0]
      : null;
    throw new HttpsError("failed-precondition", "reCAPTCHA verification failed", {
      code: "recaptcha-verify-failed",
      recaptchaScore: recaptchaResult.score,
      recaptchaError: recaptchaResult.raw?.error ?? null,
      ...(firstErrorCode != null ? { recaptchaErrorCode: firstErrorCode } : {}),
      recaptchaAction: recaptchaResult.action ?? null,
    });
  }
  if (typeof recaptchaResult.score === "number" && recaptchaResult.score < RECAPTCHA_GREY_ZONE_MIN) {
    throw new HttpsError("failed-precondition", "reCAPTCHA score too low", {
      code: "low-score-robot", recaptchaScore: recaptchaResult.score,
    });
  }
  if (typeof recaptchaResult.score === "number" && recaptchaResult.score < RECAPTCHA_MIN_SCORE) {
    throw new HttpsError("failed-precondition", "reCAPTCHA grey zone requires challenge", {
      code: "recaptcha-greyzone-requires-challenge",
      recaptchaScore: recaptchaResult.score,
      minScore: RECAPTCHA_MIN_SCORE,
    });
  }
}

/** 判斷是否允許略過嚴格安全驗證（旗標 + localhost origin 缺一不可）。 */
export function shouldBypassHardSecurity(context) {
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return HARD_SECURITY_BYPASS_FLAG === "true" && isLocalOrigin;
}

/** 驗證 Firebase Auth；未登入直接拋出 unauthenticated。 */
export function requireAuth(context) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Authentication required", { code: "auth-required" });
  }
}
