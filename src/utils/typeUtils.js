/**
 * typeUtils — 類型安全防線
 * 統一「純物件」判定，排除 null 與 Array，供 WarzoneDataContext、AccountService、VoteService 等使用。
 */

/**
 * 判斷是否為純物件（plain object），排除 null 與 Array。
 * @param {unknown} val
 * @returns {val is Record<string, unknown>}
 */
export function isObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}
