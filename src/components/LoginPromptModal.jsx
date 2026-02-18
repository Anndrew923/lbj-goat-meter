/**
 * LoginPromptModal — 投票權限阻擋提示
 * 當匿名觀察者點擊立場時彈出，引導登入後才能投票與領取戰報卡。
 * variant="limbo"：已登入但未完成 Profile，引導完成戰區登錄（用戶名、國家、立場）。
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

export default function LoginPromptModal({ open, onClose, variant, onCompleteWarzone }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const isLimbo = variant === 'limbo'

  useEffect(() => {
    if (!open) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  const handleGoLogin = () => {
    onClose?.()
    navigate('/')
  }

  const handleCompleteWarzone = () => {
    onClose?.()
    onCompleteWarzone?.()
  }

  const titleId = 'login-prompt-title'
  const descId = 'login-prompt-desc'
  const title = isLimbo ? t('completeWarzonePromptTitle') : t('needLogin')
  const desc = isLimbo ? t('completeWarzonePromptDesc') : t('loginPromptDesc')

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <motion.div
        className="rounded-xl border-2 border-king-gold/50 bg-gray-900 p-6 max-w-sm w-full shadow-xl shadow-king-gold/10"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold text-king-gold mb-2">
          {title}
        </h2>
        <p id={descId} className="text-gray-300 text-sm mb-6">
          {desc}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-400 hover:text-gray-300 transition-colors"
          >
            {t('later')}
          </button>
          {isLimbo ? (
            <button
              type="button"
              onClick={handleCompleteWarzone}
              className="flex-1 py-2 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors"
            >
              {t('completeWarzonePromptButton')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoLogin}
              className="flex-1 py-2 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors"
            >
              {t('goToLogin')}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
