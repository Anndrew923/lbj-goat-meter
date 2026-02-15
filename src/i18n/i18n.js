/**
 * i18n — 雙層語義架構與競技語感維護中心
 *
 * ## 設計意圖（為什麼這樣做）
 *
 * 1. **雙層語義**：arena.json 中每個立場／原因皆以 primary（英文）、secondary（中文）並存，
 *    讓 UI 可同時呈現「大字英文標籤 + 小字中文說明」，兼顧國際辨識度與在地語感。
 *
 * 2. **品牌詞鎖定**：brand.json 收錄 GOAT、FRAUD、LeGM 等「競技黑話」與梗詞。
 *    - 這些詞禁止被翻譯或改寫，一律以鎖定樣式顯示（如全大寫 GOAT）。
 *    - 透過 resolveBrand() 統一解析，確保不論語系切換或未來多語擴充，品牌詞始終一致。
 *    - 目的：維持產品的「競技語感」與社群辨識度，避免翻譯破壞梗或造成歧義。
 *
 * 3. **多球星複製模式**（未來擴展 Curry / Kobe 等）：
 *    - 目錄結構建議：i18n/{starId}/arena.json、i18n/{starId}/brand.json，或
 *      i18n/arena.json 內以 starId 為 key 分組（如 arena.lbj.stances、arena.curry.stances）。
 *    - brand.json 可依球星拆分（brand.lbj.json、brand.curry.json），因各球星社群梗不同。
 *    - 本模組對外只暴露「當前球星」的 getStance / getReason 等 API；切換球星時由上層
 *      切換 starId 並重新載入對應 arena/brand，或在此處接納 starId 參數並做 lazy load。
 *    - 複製步驟：(1) 複製 arena.json 結構，改寫立場／原因文案；(2) 新增該球星的 brand.json；
 *      (3) 若有共用詞（如 GOAT），可保留在共用 brand 或各球星 brand 中引用。
 *
 * 4. **潛在影響**：新增語系（如 ja）時，需在 arena 中擴充 tertiary 或改為 locale key 結構，
 *    並在 getStance / getReason 中依 locale 選擇欄位；品牌詞仍只讀 brand，不隨語系變動。
 */

import arenaData from './arena.json'
import brandData from './brand.json'
import { STANCES } from '../lib/constants'
import i18n from './config'

const STANCE_ORDER = STANCES.map((s) => s.value)

/** 取得當前語系的 arena.reasons，供 getReason / getReasonsForStance 使用，語系切換後即時生效 */
function getReasonsResource() {
  const lng = i18n.language || 'zh-TW'
  const bundle = typeof i18n.getResourceBundle === 'function' && i18n.getResourceBundle(lng, 'arena')
  if (bundle && typeof bundle.reasons === 'object') return bundle.reasons
  const fallback = typeof i18n.getResourceBundle === 'function' && i18n.getResourceBundle('zh-TW', 'arena')
  if (fallback?.reasons) return fallback.reasons
  return arenaData.reasons || {}
}

/** 品牌詞表：key 為比對用（含大小寫變體），value 為對外顯示的鎖定字串（禁止翻譯） */
const BRAND_MAP = new Map(
  Object.entries(brandData).map(([k, v]) => [k, v])
)

/**
 * 解析品牌詞：若傳入文字為品牌詞，回傳 brand.json 中的鎖定顯示值；否則回傳原字串。
 * 用於 primary 顯示時確保 GOAT / LeGM 等不被翻譯、維持全大寫或約定樣式。
 * @param {string} text - 候選文字（如 "GOAT"、"LeGM"）
 * @returns {string} 鎖定顯示字串或原 text
 */
export function resolveBrand(text) {
  if (text == null || typeof text !== 'string') return text
  const trimmed = text.trim()
  if (BRAND_MAP.has(trimmed)) return BRAND_MAP.get(trimmed)
  return text
}

/**
 * 取得單一立場的雙層語義；由 react-i18next 的 arena 語系檔提供 primary / secondary。
 * @param {string} stanceKey - 立場 value（如 'goat', 'fraud'）
 * @returns {{ primary: string, secondary: string } | null}
 */
export function getStance(stanceKey) {
  if (stanceKey == null || typeof stanceKey !== 'string') return null
  if (!STANCE_ORDER.includes(stanceKey)) return null
  const primary = i18n.t('arena:stances.' + stanceKey + '.primary')
  const secondary = i18n.t('arena:stances.' + stanceKey + '.secondary')
  return {
    primary: resolveBrand(primary),
    secondary: secondary ?? primary,
  }
}

/**
 * 供 VotingArena / 篩選器等使用的立場列表：與 STANCES 順序一致，並附上 primary / secondary。
 * 含 theme 以便按鈕沿用 king-gold / villain-purple 等樣式。
 */
export function getStancesForArena() {
  return STANCE_ORDER.map((value) => {
    const theme = STANCES.find((s) => s.value === value)?.theme ?? 'gray'
    const semantic = getStance(value)
    return {
      value,
      theme,
      primary: semantic?.primary ?? value,
      secondary: semantic?.secondary ?? value,
    }
  })
}

/**
 * 取得單一原因標籤的雙層語義；primary 會經 resolveBrand 處理。
 * @param {string} stanceKey - 立場 value
 * @param {string} reasonValue - 原因 value（如 '411', 'leGM'）
 * @returns {{ primary: string, secondary: string } | null}
 */
export function getReason(stanceKey, reasonValue) {
  if (stanceKey == null || reasonValue == null) return null
  const reasons = getReasonsResource()
  const list = reasons[stanceKey]
  if (!Array.isArray(list)) return null
  const entry = list.find((r) => r.value === reasonValue)
  if (!entry) return null
  return {
    primary: resolveBrand(entry.primary),
    secondary: entry.secondary ?? entry.primary,
  }
}

/**
 * 取得某立場下的原因列表（用於標籤雲按鈕），每項含 value、primary、secondary。
 */
export function getReasonsForStance(stanceKey) {
  if (stanceKey == null || typeof stanceKey !== 'string') return []
  const reasons = getReasonsResource()
  const list = reasons[stanceKey]
  if (!Array.isArray(list)) return []
  return list.map((r) => ({
    value: r.value,
    primary: resolveBrand(r.primary),
    secondary: r.secondary ?? r.primary,
  }))
}

/**
 * 依當前語境取得原因標籤列表（用於戰報卡等顯示）。
 * 回傳 secondary（中文）陣列，若需英文可改為 primary 或擴充 locale 參數。
 * @param {string} stanceKey - 立場 value
 * @param {string[]} reasonValues - 原因 value 陣列（如 profile.currentReasons）
 * @returns {string[]} 對應的標籤字串陣列
 */
export function getReasonLabels(stanceKey, reasonValues) {
  if (!Array.isArray(reasonValues) || stanceKey == null) return []
  return reasonValues.map((v) => {
    const semantic = getReason(stanceKey, v)
    return semantic ? semantic.secondary : v
  })
}

/**
 * 取得單一立場的「主顯示標籤」：用於 BattleCard / LiveTicker 等單一語境。
 * 可選 locale：'en' -> primary，'zh' 或預設 -> secondary。
 * @param {string} stanceKey
 * @param {'en'|'zh'} [locale='zh']
 * @returns {string}
 */
export function getStanceDisplay(stanceKey, locale = 'zh') {
  const semantic = getStance(stanceKey)
  if (!semantic) return (typeof stanceKey === 'string' && stanceKey) ? stanceKey : '—'
  if (locale === 'en') return semantic.primary
  return semantic.secondary
}

/**
 * LiveTicker 等處的「主顯示名」：回傳 primary（品牌詞已經 resolveBrand）。
 * 與 getStanceDisplay(stanceKey, 'en') 一致。
 */
export function getStanceDisplayTicker(stanceKey) {
  const semantic = getStance(stanceKey)
  if (!semantic) return (typeof stanceKey === 'string' && stanceKey) ? stanceKey : '—'
  return semantic.primary
}

/**
 * 所有原因 value -> 單一顯示標籤（secondary）的映射，供儀表板等處使用。
 * 依 STANCE_ORDER 迭代，同一 value 出現在多立場（如 iq）時以首次出現為準，與 getStancesForArena 順序一致。
 */
/** 依當前語系建立 reason value -> 顯示標籤（secondary）的映射；語系切換後需重新呼叫以更新。 */
export function getReasonLabelMap() {
  const m = {}
  const reasons = getReasonsResource()
  STANCE_ORDER.forEach((stanceKey) => {
    const list = reasons[stanceKey]
    if (!Array.isArray(list)) return
    list.forEach((r) => {
      if (m[r.value] === undefined) m[r.value] = r.secondary ?? r.primary
    })
  })
  return m
}
