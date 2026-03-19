/**
 * 突發戰區 optionIndex 正規化 — 必須與前端 VoteService 使用相同規則，
 * 否則 Golden Key 的 JSON.stringify(payload) 會與後端不一致而 signature-mismatch。
 *
 * @param {unknown} optionIndex
 * @returns {number}
 */
export function normalizeBreakingOptionIndex(optionIndex) {
  if (typeof optionIndex === "number" && Number.isFinite(optionIndex)) {
    return Math.trunc(optionIndex);
  }
  if (typeof optionIndex === "string") {
    const t = optionIndex.trim();
    if (t && /^-?\d+$/.test(t)) {
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}
