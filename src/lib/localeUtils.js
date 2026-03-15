/**
 * 動態雙語資料的語系提取工具 — 供突發戰區、BreakingPoll 等組件共用。
 *
 * 設計意圖：
 * - Firestore 存儲格式為 { "zh-TW": "...", "en": "..." }，前端依當前語系取値並 fallback 到 en。
 * - 相容舊資料（字串）與新資料（語系物件）。
 */

const FALLBACK_LOCALE = 'en'

/**
 * 從雙語物件依指定語系取文案，缺漏時 fallback 到 en。
 * 相容舊資料：若為字串則直接回傳。
 *
 * @param {Record<string, string> | string | null | undefined} localeMap - 語系物件或舊版字串
 * @param {string} [language] - 當前語系（如 'zh-TW', 'en'）；若為 'zh' 會嘗試 'zh-TW'
 * @returns {string}
 */
export function getLocalizedText(localeMap, language) {
  if (localeMap == null) return ''
  if (typeof localeMap === 'string') return localeMap
  const lang = (language || FALLBACK_LOCALE).trim()
  const effectiveLang = lang.startsWith('zh') && lang !== 'zh-TW' ? 'zh-TW' : lang
  const primary = String(localeMap[effectiveLang] ?? '').trim()
  const fallback = String(localeMap[FALLBACK_LOCALE] ?? '').trim()
  return primary || fallback || ''
}
