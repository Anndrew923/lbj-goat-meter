/**
 * LoginPromptModal — 投票權限阻擋提示
 * 當訪客點擊立場時彈出，引導登入後才能投票與領取戰報卡。
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

export default function LoginPromptModal({ open, onClose }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()

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

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-prompt-title"
      aria-describedby="login-prompt-desc"
    >
      <motion.div
        className="rounded-xl border-2 border-king-gold/50 bg-gray-900 p-6 max-w-sm w-full shadow-xl shadow-king-gold/10"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="login-prompt-title" className="text-lg font-bold text-king-gold mb-2">
          {t('needLogin')}
        </h2>
        <p id="login-prompt-desc" className="text-gray-300 text-sm mb-6">
          {t('loginPromptDesc')}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-400 hover:text-gray-300 transition-colors"
          >
            {t('later')}
          </button>
          <button
            type="button"
            onClick={handleGoLogin}
            className="flex-1 py-2 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors"
          >
            {t('goToLogin')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
