/**
 * 全球國家名單 — 基於 i18n-iso-countries，熱門置頂、其餘依語系排序。
 * 供 SmartWarzoneSelector / UserProfileSetup 使用，支援完整 ISO 國家與 i18n。
 * zh-TW 使用自訂繁體語系包，確保無簡體殘留。
 */
import * as countries from 'i18n-iso-countries'
import enLocale from 'i18n-iso-countries/langs/en.json'
import zhLocale from 'i18n-iso-countries/langs/zh.json'
import zhTWLocale from './langs/zh-TW.json'

countries.registerLocale(enLocale)
countries.registerLocale(zhLocale)
countries.registerLocale(zhTWLocale)

/** 熱門國家置頂順序（台灣、美國、日本、韓國、香港、加拿大、澳洲、菲律賓） */
export const POPULAR_COUNTRY_CODES = ['TW', 'US', 'JP', 'KR', 'HK', 'CA', 'AU', 'PH']

/** i18n-iso-countries 註冊用繁體語系代碼（小寫以符合套件 lookup） */
const LOCALE_ZH_TW = 'zh-tw'

/**
 * 取得用於選單的語系代碼。
 * zh-TW / zh-Hant 時使用繁體語系包，其餘 zh 使用簡體，避免簡體殘留。
 * @param {string} [lang] - 如 'zh-TW' | 'en'
 * @returns {string} 'zh-tw' | 'zh' | 'en'
 */
function getLocaleForCountries(lang) {
  if (lang && (lang === 'zh-TW' || lang.toLowerCase() === LOCALE_ZH_TW || lang.startsWith('zh-Hant'))) return LOCALE_ZH_TW
  if (lang && lang.startsWith('zh')) return 'zh'
  return 'en'
}

/** 將 i18n-iso-countries 回傳的 name（可能為 string 或 array）正規化為字串 */
function normalizeName(name) {
  if (Array.isArray(name) && name.length) return name[name.length - 1] // 簡稱常在第末項
  return typeof name === 'string' ? name : ''
}

/**
 * 取得單一國家顯示名稱（zh-TW 使用繁體語系包）
 * @param {string} code - ISO 3166-1 alpha-2
 * @param {string} [lang] - 如 'zh-TW' | 'en'
 * @returns {string} 語系對應的國家顯示名稱，無則回傳 code
 */
export function getCountryName(code, lang) {
  if (!code || typeof code !== 'string') return ''
  const key = code.toUpperCase().slice(0, 2)
  const locale = getLocaleForCountries(lang)
  const name = countries.getName(key, locale, { select: 'alias' }) || countries.getName(key, locale)
  return normalizeName(name) || key
}

/**
 * 取得完整國家選項列表：熱門置頂，其餘依語系 A-Z 排序。
 * @param {string} [lang='en'] - 如 'zh-TW' | 'en'
 * @returns {{ value: string, label: string }[]}
 */
export function getCountryOptions(lang = 'en') {
  const locale = getLocaleForCountries(lang)
  const names = countries.getNames(locale, { select: 'alias' }) || countries.getNames(locale) || {}
  const allCodes = Object.keys(names).filter((c) => c.length === 2 && c === c.toUpperCase())
  const withTW = allCodes.includes('TW') ? allCodes : ['TW', ...allCodes]

  const popular = POPULAR_COUNTRY_CODES.filter((code) => withTW.includes(code)).map((value) => ({
    value,
    label: getCountryName(value, lang),
  }))
  const restCodes = withTW.filter((c) => !POPULAR_COUNTRY_CODES.includes(c))
  const rest = restCodes
    .map((value) => ({ value, label: getCountryName(value, lang) }))
    .sort((a, b) => (a.label || '').localeCompare(b.label || '', locale === LOCALE_ZH_TW ? 'zh-Hant' : locale === 'zh' ? 'zh-Hans' : 'en'))

  return [...popular, ...rest]
}
