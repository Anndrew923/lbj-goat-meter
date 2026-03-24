import crypto from "crypto";
import * as functions from "firebase-functions";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function getSecret(secretOverride = "") {
  const fromEnv = process.env.GOLDEN_KEY_SECRET || process.env.GOAT_GOLDEN_KEY_SECRET || "";
  const raw = secretOverride || fromEnv;
  const v = String(raw).trim();
  if (!v) {
    functions.logger.warn("[GoldenKey] Secret not configured. Verification will always fail as strict mode.");
  }
  return v || null;
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj || {});
  } catch {
    return "{}";
  }
}

/**
 * 後端黃金鑰匙驗證：
 * - 預期前端以 createGoldenKeySignature(action, payloadSub) 產生：
 *   - xGoatTimestamp: Unix ms
 *   - xGoatSignature: hex(HMAC_SHA256(secret, `${action}|${timestamp}|${JSON.stringify(payloadSub)}`))
 * - 此處僅負責：
 *   - 1) 驗證 timestamp 合理（±5 分鐘）
 *   - 2) 驗證 HMAC 是否匹配
 *
 * 設計意圖：
 * - 作為「額外一層完整性訊號」，提升腳本濫用門檻，並提供有結構的錯誤 log。
 * - 一旦驗證失敗，以 HttpsError("permission-denied") 統一回應。
 *
 * @param {"submit_vote"|"reset_position"|"submit_breaking_vote"} action
 * @param {unknown} payloadForHash - 與前端簽章時使用的 payloadSub 同結構
 * @param {{ xGoatTimestamp?: unknown, xGoatSignature?: unknown }} goldenFields
 * @param {{ uid?: string, deviceId?: string, extra?: Record<string, unknown> }} meta
 * @param {string} [secretOverride] - 由 firebase-functions/params defineSecret 注入的密鑰字串
 */
export function verifyGoldenKey(action, payloadForHash, goldenFields, meta = {}, secretOverride = "") {
  const secret = getSecret(secretOverride);
  const { xGoatTimestamp, xGoatSignature } = goldenFields || {};
  const ts = Number(xGoatTimestamp);
  const sig = typeof xGoatSignature === "string" ? xGoatSignature : "";

  const now = Date.now();
  const drift = Math.abs(now - ts);

  const baseLog = {
    action,
    uid: meta.uid || null,
    deviceId: meta.deviceId || null,
    timestamp: ts || null,
    now,
    drift,
    hasSignature: Boolean(sig),
    extra: meta.extra || {},
  };

  if (!Number.isFinite(ts) || ts <= 0) {
    functions.logger.error("[GoldenKey][invalid-timestamp]", {
      ...baseLog,
      code: "invalid-timestamp",
    });
    throw new functions.https.HttpsError("permission-denied", "Invalid signature timestamp", {
      code: "signature-invalid-timestamp",
    });
  }

  if (drift > DEFAULT_MAX_SKEW_MS) {
    functions.logger.error("[GoldenKey][timestamp-skew]", {
      ...baseLog,
      code: "timestamp-skew",
      maxSkewMs: DEFAULT_MAX_SKEW_MS,
    });
    throw new functions.https.HttpsError("permission-denied", "Signature expired or from future", {
      code: "signature-timestamp-skew",
    });
  }

  if (!secret || !sig) {
    functions.logger.error("[GoldenKey][missing-signature-or-secret]", {
      ...baseLog,
      code: "missing-signature-or-secret",
    });
    throw new functions.https.HttpsError("permission-denied", "Signature missing", {
      code: "signature-missing",
    });
  }

  const payloadJson = safeJsonStringify(payloadForHash);
  const message = `${action}|${ts}|${payloadJson}`;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");

  const hexOk = /^[0-9a-f]+$/i.test(sig) && sig.length % 2 === 0 && sig.length === expected.length;
  if (!hexOk) {
    functions.logger.error("[GoldenKey][mismatch]", {
      ...baseLog,
      code: "signature-mismatch",
      reason: "invalid-hex-or-length",
    });
    throw new functions.https.HttpsError("permission-denied", "Signature mismatch", {
      code: "signature-mismatch",
    });
  }

  const expectedBuf = Buffer.from(expected, "hex");
  const sigBuf = Buffer.from(sig, "hex");

  // 長度不一致時，timingSafeEqual 會丟 RangeError；改為先檢查長度，再做常數時間比較。
  if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
    functions.logger.error("[GoldenKey][mismatch]", {
      ...baseLog,
      code: "signature-mismatch",
    });
    throw new functions.https.HttpsError("permission-denied", "Signature mismatch", {
      code: "signature-mismatch",
    });
  }

  // 驗證通過：僅作為資訊 log，不拋錯。
  functions.logger.debug("[GoldenKey][ok]", {
    action,
    uid: meta.uid || null,
    deviceId: meta.deviceId || null,
    drift,
  });
}

