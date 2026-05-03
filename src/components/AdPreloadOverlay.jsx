/**
 * AdPreloadOverlay — 廣告準備中的全螢幕情境化提示
 *
 * 設計意圖：
 *   - 在廣告 SDK 接管畫面「之前」顯示，給用戶沉浸式的情境說明，而非突兀的原生廣告。
 *   - 可重用於三種廣告場景：battle_card（戰報卡）、extra_vote（重置立場）、intel（情報解鎖）。
 *   - adContext → 對應 common.json 的 ad_prompt_* key，不在此元件硬編碼任何文案。
 *   - z-[300]：高於 AdMobPortal (z-[200]) 與 Modal 群組，確保一定看得到。
 */
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'

export default function AdPreloadOverlay({ open, adContext }) {
  const { t } = useTranslation('common')

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="ad-preload-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className="fixed inset-0 z-[300] bg-black/96 flex flex-col items-center justify-center text-center px-8"
          aria-live="polite"
          role="status"
        >
          {/* 閃光圖標 */}
          <div className="mb-5 text-5xl" aria-hidden="true">⚡</div>

          {/* 情境文案 */}
          <p className="text-white text-lg font-bold leading-snug max-w-xs mb-3">
            {adContext ? t(`ad_prompt_${adContext}`) : t('adPortalLoadingTitle')}
          </p>

          {/* 支持說明 */}
          <p className="text-white/50 text-sm max-w-xs">
            {t('ad_support_msg')}
          </p>

          {/* 三點跳動 Loading 指示器 */}
          <div className="mt-8 flex gap-2" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-king-gold animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 rounded-full bg-king-gold animate-bounce [animation-delay:160ms]" />
            <span className="w-2 h-2 rounded-full bg-king-gold animate-bounce [animation-delay:320ms]" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}
