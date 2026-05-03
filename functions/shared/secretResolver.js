/**
 * shared/secretResolver.js — Secret 解析與快取
 *
 * 設計意圖：
 * - Firebase 於實例啟動時將 Secret 掛載至環境；.value() 通常為本地讀取，無網路成本。
 * - boundSecretStringCache 在同一冷啟程序內快取解析結果，避免同一請求多次走 try/catch 分支。
 * - Secret 版本更新後新部署會起新程序，快取自然失效，不需手動清除。
 * - Emulator 或未掛載 Secret 時，回退至 envKeys 列表的環境變數，便於本機開發。
 * - 各 Feature 的具名 resolver（resolveFingerprintPepper 等）讓呼叫端不需記憶 envKeys 細節，
 *   降低跨功能模組的耦合。
 */
import * as functions from "firebase-functions";

const boundSecretStringCache = new Map();
const boundSecretMissingLogged = new Set();

/**
 * 通用 Secret 解析：優先 .value()，fallback 至 envKeys，正式環境缺值時記錄一次警告。
 * @param {{ name: string, value: () => string }} secretParam - defineSecret 回傳的 SecretParam
 * @param {{ envKeys?: string[], kServiceWarn?: string }} opts
 */
export function resolveBoundSecretString(secretParam, opts = {}) {
  const { envKeys = [], kServiceWarn } = opts;
  const name = secretParam.name;
  if (boundSecretStringCache.has(name)) {
    return boundSecretStringCache.get(name);
  }

  let resolved = "";
  try {
    const v = secretParam.value();
    if (typeof v === "string" && v.trim() !== "") resolved = v.trim();
  } catch {
    // Emulator 或 Secret 尚未掛載時靜默 fallback
  }
  if (!resolved) {
    for (const k of envKeys) {
      const fromEnv = typeof process.env[k] === "string" ? process.env[k].trim() : "";
      if (fromEnv) { resolved = fromEnv; break; }
    }
  }

  boundSecretStringCache.set(name, resolved);

  if (!resolved && process.env.K_SERVICE && kServiceWarn && !boundSecretMissingLogged.has(name)) {
    boundSecretMissingLogged.add(name);
    functions.logger.warn(kServiceWarn);
  }

  return resolved;
}

/** 解析設備指紋 HMAC pepper */
export function resolveFingerprintPepper(secret) {
  return resolveBoundSecretString(secret, {
    envKeys: ["GOAT_FINGERPRINT_PEPPER"],
    kServiceWarn:
      "[submitVote] GOAT_FINGERPRINT_PEPPER 未解析：24h 裝置查重已停用，請確認 Secret 已綁定並部署",
  });
}

/** 解析 Golden Key HMAC 簽章金鑰 */
export function resolveGoldenKeySecret(secret) {
  return resolveBoundSecretString(secret, {
    envKeys: ["GOLDEN_KEY_SECRET", "GOAT_GOLDEN_KEY_SECRET"],
    kServiceWarn:
      "[GoldenKey] GOAT_GOLDEN_KEY_SECRET 未解析，簽章驗證將失敗。請確認 Secret 已綁定並部署。",
  });
}

/** 解析廣告獎勵 Token 簽章金鑰 */
export function resolveAdRewardSigningSecret(secret) {
  return resolveBoundSecretString(secret, {
    envKeys: ["AD_REWARD_SIGNING_SECRET"],
    kServiceWarn:
      "[adReward] AD_REWARD_SIGNING_SECRET 未解析：原生 App 看完廣告後無法簽發 Token，請在 Secret Manager 建立並綁定至 issueAdRewardToken、resetPosition",
  });
}

/** 解析 reCAPTCHA v3 後端 Secret Key */
export function resolveRecaptchaSecret(secret) {
  return resolveBoundSecretString(secret, {
    envKeys: ["RECAPTCHA_SECRET"],
    kServiceWarn:
      "[verifyRecaptcha] RECAPTCHA_SECRET 未解析：請在 Secret Manager 建立名為 RECAPTCHA_SECRET 的 secret，並執行 firebase deploy --only functions 以綁定至 submitVote、submitBreakingVote。",
  });
}
