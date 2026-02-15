/**
 * react-i18next 核心地基 — 雙層語義與長遠擴展
 *
 * 設計意圖：
 * - 語系檔置於 locales/{lng}/，arena 採用 primary（大字英文）/ secondary（小字註解）結構。
 * - 預設 zh-TW，支援 en；語系選擇持久化至 localStorage，下次開啟還原。
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import arenaZh from './locales/zh-TW/arena.json'
import commonZh from './locales/zh-TW/common.json'
import arenaEn from './locales/en/arena.json'
import commonEn from './locales/en/common.json'

const LANGUAGE_STORAGE_KEY = 'goat-meter-lang'
const SUPPORTED_LANGS = ['zh-TW', 'en']

function getStoredLanguage() {
  if (typeof localStorage === 'undefined') return 'zh-TW'
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return SUPPORTED_LANGS.includes(stored) ? stored : 'zh-TW'
}

const resources = {
  'zh-TW': {
    arena: arenaZh,
    common: commonZh,
  },
  en: {
    arena: arenaEn,
    common: commonEn,
  },
}

i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguage(),
  fallbackLng: 'zh-TW',
  defaultNS: 'common',
  ns: ['arena', 'common'],
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  if (typeof localStorage !== 'undefined' && SUPPORTED_LANGS.includes(lng)) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  }
})

export default i18n
export { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGS }
