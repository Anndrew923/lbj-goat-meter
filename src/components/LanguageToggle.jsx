/**
 * LanguageToggle — 語系切換（zh-TW / en）
 * 使用 i18next.changeLanguage()，語系會持久化至 localStorage（由 config 監聽 languageChanged 寫入）。
 */
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED_LANGS } from '../i18n/config'

const LABEL_KEYS = { 'zh-TW': 'lang_zhTW', en: 'lang_en' }

/** 將 i18n.language（可能為 en-US 等）正規化為 SUPPORTED_LANGS 其一，供比對與高亮用 */
function resolveDisplayLanguage(lng) {
  if (!lng) return 'zh-TW'
  if (lng === 'zh-TW') return 'zh-TW'
  if (lng.startsWith('en')) return 'en'
  return 'zh-TW'
}

export default function LanguageToggle() {
  const { t } = useTranslation('common')
  const current = resolveDisplayLanguage(i18n.language)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        {t('language')}
      </span>
      <div className="flex gap-2">
        {SUPPORTED_LANGS.map((lng) => (
          <button
            key={lng}
            type="button"
            onClick={() => i18n.changeLanguage(lng)}
            className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
              current === lng
                ? 'bg-king-gold text-black'
                : 'bg-gray-800 text-gray-400 border border-gray-600 hover:border-king-gold/50 hover:text-king-gold'
            }`}
          >
            {t(LABEL_KEYS[lng])}
          </button>
        ))}
      </div>
    </div>
  )
}
