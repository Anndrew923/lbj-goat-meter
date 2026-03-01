/**
 * ExitConfirmModal — 離開戰區確認
 * 軍事儀表板風格，深色半透明遮罩；金/灰按鈕。
 * 留在戰區：關閉；離開：原生環境呼叫 App.exitApp()，Web 僅關閉 Modal。
 * 若 Modal 已開啟時用戶再按返回鍵，由 App 層直接執行退出。
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

export default function ExitConfirmModal({ open, onClose, onExit }) {
  const { t } = useTranslation('common')
  const stayButtonRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  useEffect(() => {
    if (open && stayButtonRef.current) {
      stayButtonRef.current.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  const handleStay = () => {
    onClose?.()
  }

  const handleExit = () => {
    onClose?.()
    onExit?.()
    if (Capacitor.isNativePlatform()) {
      App.exitApp()
    }
  }

  const titleId = 'exit-confirm-title'
  const descId = 'exit-confirm-desc'

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleStay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <motion.div
        className="rounded-xl border-2 border-king-gold/50 bg-gray-900/95 p-6 max-w-sm w-full shadow-xl shadow-king-gold/10"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold text-king-gold mb-2">
          {t('exitModalTitle')}
        </h2>
        <p id={descId} className="text-gray-300 text-sm mb-6">
          {t('exitModalMessage')}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            ref={stayButtonRef}
            onClick={handleStay}
            className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-300 bg-gray-800 hover:bg-gray-700 hover:text-gray-200 transition-colors font-medium"
          >
            {t('stayInWarzone')}
          </button>
          <button
            type="button"
            onClick={handleExit}
            className="flex-1 py-2.5 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors"
          >
            {t('exitApp')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
