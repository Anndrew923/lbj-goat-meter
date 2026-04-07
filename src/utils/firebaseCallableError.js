/**
 * Firebase Callable（HttpsError）錯誤的業務 code 可能在 details 或 customData（依 SDK／版本）。
 * 與後端 throw new HttpsError(..., { code: "..." }) 對齊，避免只讀 err.code（多為 functions/xxx）。
 *
 * @param {unknown} err
 * @returns {string | null}
 */
export function getCallableDetailsCode(err) {
  if (!err || typeof err !== "object") return null;
  const d = err.details ?? err.customData;
  const code = d && typeof d === "object" && typeof d.code === "string" ? d.code.trim() : "";
  return code || null;
}
