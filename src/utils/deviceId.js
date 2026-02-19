/**
 * 取得或產生當前設備的穩定識別碼，用於投票公信力機制（device_locks 連動解鎖）。
 * 優先使用 localStorage 持久化，無則產生並寫回。回傳值適合作為 Firestore 文件 ID（無 "/"，長度合理）。
 */

const STORAGE_KEY = "lbj_goat_device_id";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/**
 * 回傳當前設備的穩定識別碼（同一瀏覽器／裝置內一致）。
 * 無 localStorage 時（如 SSR）每次呼叫可能不同，僅客戶端投票流程可依賴「一設備一票」。
 *
 * @returns {string} 非空字串，可作為 device_locks 文件 ID
 */
export function getDeviceId() {
  if (typeof localStorage === "undefined") return generateId();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (typeof stored === "string" && stored.trim().length > 0) return stored.trim();
    const id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return generateId();
  }
}
