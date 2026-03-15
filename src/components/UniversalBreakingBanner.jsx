/**
 * UniversalBreakingBanner — 突發戰區通用入口
 *
 * 設計意圖：
 * - 跨專案通用：從 global_events 讀取 target_app 包含當前專案 ID 的活動，投票前／投票後皆顯示。
 * - 動態雙語：標題、描述、選項自 Firestore 語系物件提取，依 useTranslation 語系渲染，缺語系時 fallback 到 en。
 * - 暗黑競技風：金/紫邊框、16:9 圖區。圖片 URL 與雙語內容存於同一 Document。
 */
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import { useGlobalBreakingEvents } from '../hooks/useGlobalBreakingEvents'
import { PROJECT_APP_ID } from '../lib/constants'
import { getLocalizedText } from '../lib/localeUtils'

const ASPECT_RATIO = 16 / 9

export default function UniversalBreakingBanner({ appId = PROJECT_APP_ID }) {
  const { t, i18n } = useTranslation('common')
  const { events, loading, error } = useGlobalBreakingEvents(appId)
  const lang = i18n.language || 'en'

  if (loading) {
    return (
      <div
        className="rounded-xl border border-villain-purple/20 bg-gray-900/50 px-4 py-3 text-center"
        role="status"
        aria-label={t('breakingLoading')}
      >
        <p className="text-sm text-gray-500 animate-pulse">{t('breakingLoading')}</p>
      </div>
    )
  }

  if (error || !events?.length) {
    return null
  }

  return (
    <div className="space-y-3">
      {events.map((ev) => {
        const titleText = getLocalizedText(ev.title, lang)
        const descText = getLocalizedText(ev.description, lang)
        const optionsList = Array.isArray(ev.options) ? ev.options : []

        return (
          <motion.article
            key={ev.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-king-gold/40 bg-gray-900/80 overflow-hidden shadow-lg shadow-king-gold/5"
          >
            <div
              className="relative w-full overflow-hidden"
              style={{ aspectRatio: ASPECT_RATIO }}
            >
              {ev.image_url ? (
                <img
                  src={ev.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-king-gold/10 to-villain-purple/10">
                  <Zap className="w-10 h-10 text-king-gold/60" aria-hidden />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
                <span className="text-[10px] uppercase tracking-wider text-king-gold/90 font-semibold">
                  {t('breakingTitle')}
                </span>
                <p className="text-white font-semibold text-sm line-clamp-2 mt-0.5">
                  {titleText || ''}
                </p>
                {descText && (
                  <p className="text-gray-300 text-xs line-clamp-1 mt-0.5">
                    {descText}
                  </p>
                )}
              </div>
            </div>
            {optionsList.length > 0 && (
              <div className="px-3 pb-3 flex flex-wrap gap-2">
                {optionsList.slice(0, 4).map((opt, i) => {
                  const label = typeof opt === 'object' && opt !== null
                    ? getLocalizedText(opt, lang)
                    : String(opt ?? '')
                  if (!label) return null
                  return (
                    <span
                      key={i}
                      className="px-2 py-1 rounded-md text-xs bg-king-gold/20 text-king-gold border border-king-gold/30"
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            )}
          </motion.article>
        )
      })}
    </div>
  )
}
