/**
 * 突發戰區選項索引 — 與 functions/utils/normalizeBreakingOptionIndex.js 規則必須一致（Golden Key）。
 * @param {unknown} optionIndex
 * @returns {number}
 */
export function normalizeBreakingOptionIndex(optionIndex) {
  if (typeof optionIndex === 'number' && Number.isFinite(optionIndex)) {
    return Math.trunc(optionIndex)
  }
  if (typeof optionIndex === 'string') {
    const t = optionIndex.trim()
    if (t && /^-?\d+$/.test(t)) {
      const n = parseInt(t, 10)
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}
