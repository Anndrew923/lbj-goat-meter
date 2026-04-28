/**
 * LoginPromptModal — 投票權限阻擋提示
 * 當匿名觀察者點擊立場時彈出，引導登入後才能投票與領取戰報卡。
 * variant="limbo"：已登入但未完成 Profile，引導完成戰區登錄（用戶名、國家、立場）。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ModalShell from './ModalShell'

export default function LoginPromptModal({ onClose, variant, onCompleteWarzone }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { isGuest, signOut } = useAuth()
  const isLimbo = variant === 'limbo'
  const [isNavigatingToLogin, setIsNavigatingToLogin] = useState(false)

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleGoLogin = async (e) => {
    e?.stopPropagation?.()
    if (isNavigatingToLogin) return
    setIsNavigatingToLogin(true)
    onClose?.(e)
    try {
      // 匿名觀察者先嘗試登出；即使登出失敗也要導往登入頁，避免按鈕看似無反應。
      if (isGuest) {
        try {
          await signOut?.()
        } catch {
          // signOut 失敗時仍導到登入頁，由登入頁承接後續重試。
        }
      }
    } finally {
      navigate('/', { replace: true })
      setIsNavigatingToLogin(false)
    }
  }

  const handleCompleteWarzone = (e) => {
    e?.stopPropagation?.()
    onClose?.(e)
    onCompleteWarzone?.()
  }

  const titleId = 'login-prompt-title'
  const descId = 'login-prompt-desc'
  const title = isLimbo ? t('completeWarzonePromptTitle') : t('needLogin')
  const desc = isLimbo ? t('completeWarzonePromptDesc') : t('loginPromptDesc')

  return (
    <ModalShell
      rootClassName="fixed inset-0 z-50 overflow-y-auto"
      backdropClassName="bg-black/90"
      panelClassName="rounded-xl border-2 border-king-gold/50 bg-gray-900 p-6 max-w-sm w-full shadow-xl shadow-king-gold/10"
      panelMotionProps={{
        initial: { scale: 0.95, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.95, opacity: 0 },
        onClick: (e) => e.stopPropagation(),
      }}
      onBackdropClick={(e) => onClose?.(e)}
      rootMotionProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': titleId,
        'aria-describedby': descId,
      }}
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
            onClick={(e) => {
              if (isNavigatingToLogin) return
              e.stopPropagation()
              onClose?.(e)
            }}
            disabled={isNavigatingToLogin}
            className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
              disabled={isNavigatingToLogin}
              className="flex-1 py-2 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isNavigatingToLogin ? t('loading') : t('goToLogin')}
            </button>
          )}
        </div>
    </ModalShell>
  )
}
