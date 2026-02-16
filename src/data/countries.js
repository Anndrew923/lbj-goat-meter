/**
 * 全球國家名單 — 基於 i18n-iso-countries，熱門置頂、其餘依語系排序。
 * 供 SmartWarzoneSelector / UserProfileSetup 使用，支援完整 ISO 國家與 i18n。
 */
import * as countries from 'i18n-iso-countries'
import enLocale from 'i18n-iso-countries/langs/en.json'
import zhLocale from 'i18n-iso-countries/langs/zh.json'

countries.registerLocale(enLocale)
countries.registerLocale(zhLocale)

/** 熱門國家置頂順序（台灣、美國、日本、韓國、香港、加拿大、澳洲、菲律賓） */
export const POPULAR_COUNTRY_CODES = ['TW', 'US', 'JP', 'KR', 'HK', 'CA', 'AU', 'PH']

/** 繁體中文熱門國家顯示名（覆寫 i18n-iso-countries 的簡體） */
const POPULAR_NAMES_ZH_TW = {
  TW: '台灣',
  US: '美國',
  JP: '日本',
  KR: '韓國',
  HK: '香港',
  CA: '加拿大',
  AU: '澳洲',
  PH: '菲律賓',
}

/**
 * 取得用於選單的語系代碼（i18n-iso-countries 用 en / zh，無 zh-TW）
 * @param {string} lang - 如 'zh-TW' | 'en'
 */
function getLocaleForCountries(lang) {
  if (lang && lang.startsWith('zh')) return 'zh'
  return 'en'
}

/** 將 i18n-iso-countries 回傳的 name（可能為 string 或 array）正規化為字串 */
function normalizeName(name) {
  if (Array.isArray(name) && name.length) return name[name.length - 1] // 簡稱常在第末項
  return typeof name === 'string' ? name : ''
}

/**
 * 取得單一國家顯示名稱（熱門在 zh-TW 下用繁體覆寫）
 * @param {string} code - ISO 3166-1 alpha-2
 * @param {string} lang - 如 'zh-TW' | 'en'
 */
export function getCountryName(code, lang) {
  if (!code || typeof code !== 'string') return ''
  const key = code.toUpperCase().slice(0, 2)
  const locale = getLocaleForCountries(lang)
  if (locale === 'zh' && lang && lang.startsWith('zh') && POPULAR_NAMES_ZH_TW[key]) {
    return POPULAR_NAMES_ZH_TW[key]
  }
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
    .sort((a, b) => (a.label || '').localeCompare(b.label || '', locale === 'zh' ? 'zh-Hans' : 'en'))

  return [...popular, ...rest]
}
