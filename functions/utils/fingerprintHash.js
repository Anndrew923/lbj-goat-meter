/**
 * 設備識別材質（客戶端 deviceId）之伺服器端雜湊 — 設計意圖：
 * - 不在 Firestore 存「可還原」的原始指紋；僅存 SHA-256(pepper ∥ material)，pepper 來自 Secret Manager（Callable secrets）或後備環境變數。
 * - 未設定 pepper（無 Secret 且無環境變數）時回傳 null：略過 24h 查重。
 */
import crypto from "crypto";

/**
 * @param {string} deviceIdStr - 客戶端傳入之裝置識別字串（與 device_locks 鍵相同來源）
 * @param {string | undefined} [explicitPepper] - Gen2 `defineSecret` 注入值，優先於 process.env
 * @returns {string | null} 64 字元 hex，無 pepper 時為 null
 */
export function hashDeviceFingerprintMaterial(deviceIdStr, explicitPepper) {
  const pepper =
    typeof explicitPepper === "string" && explicitPepper.trim() !== ""
      ? explicitPepper.trim()
      : process.env.GOAT_FINGERPRINT_PEPPER?.trim();
  if (!pepper || typeof deviceIdStr !== "string" || !deviceIdStr.trim()) {
    return null;
  }
  return crypto
    .createHash("sha256")
    .update(pepper, "utf8")
    .update("\0", "utf8")
    .update(deviceIdStr.trim(), "utf8")
    .digest("hex");
}
