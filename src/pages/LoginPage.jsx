import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const { t } = useTranslation('common')
  const { currentUser, loading, profileLoading, hasProfile, authError, loginWithGoogle, clearAuthError, continueAsGuest } =
    useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const hasNavigatedRef = useRef(false)

  // 導向規則：僅當 currentUser 存在「且」hasProfile 為 true 時才導向 /vote。
  // 有 User 但沒 Profile → 不導向（原地不動，或由 VotePage 的 Modal 處理）；禁止沒 Profile 就送進戰場。
  useEffect(() => {
    if (loading) return
    if (profileLoading) return
    if (!currentUser) {
      hasNavigatedRef.current = false
      return
    }
    if (!hasProfile) return // 有 User 但沒 Profile：不跳轉，讓 VotePage Modal 或 /setup 流程處理
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    navigate('/vote', { replace: true })
  }, [currentUser, loading, profileLoading, hasProfile, navigate])

  const handleLogin = async () => {
    clearAuthError?.()
    setIsLoggingIn(true)
    try {
      await loginWithGoogle()
    } catch {
      // 錯誤已由 AuthContext 寫入 authError，此處僅防止 unhandled rejection
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleGuest = () => {
    clearAuthError?.()
    continueAsGuest()
    navigate('/vote', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-king-gold animate-pulse" role="status" aria-live="polite">
          {t('loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md w-full"
      >
        {/* 霸氣標題與剪影（以幾何剪影暗示，避免真人肖像） */}
        <div className="mb-8 flex flex-col items-center">
          <h1 className="text-4xl md:text-5xl font-black text-king-gold tracking-tight mb-2">
            GOAT Meter: LeBron
          </h1>
          <p className="text-villain-purple/90 text-sm mb-6">{t('whoIsGoat')}</p>
          <div
            className="w-24 h-32 rounded-lg bg-gradient-to-b from-king-gold/30 to-villain-purple/30 border border-king-gold/50"
            aria-hidden
            style={{
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            }}
          />
        </div>

        {authError && (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-red-400 text-sm" role="alert">
              {authError}
            </p>
            <button
              type="button"
              onClick={() => clearAuthError?.()}
              className="self-start py-2 px-3 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/50 hover:bg-red-500/30"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* 按鈕 A：醒目的 Google 登入（金色邊框） */}
        <motion.button
          type="button"
          whileHover={{ scale: isLoggingIn ? 1 : 1.02 }}
          whileTap={{ scale: isLoggingIn ? 1 : 0.98 }}
          className="w-full px-6 py-3.5 rounded-xl border-2 border-king-gold bg-king-gold/10 text-king-gold font-bold hover:bg-king-gold/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mb-4"
          onClick={handleLogin}
          disabled={isLoggingIn}
          aria-busy={isLoggingIn}
          aria-disabled={isLoggingIn}
        >
          {isLoggingIn ? t('loggingIn') : t('signInWithGoogle')}
        </motion.button>

        {/* 按鈕 B：不留名參觀，較小樣式 */}
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-300 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
          onClick={handleGuest}
          aria-label={t('browseAsGuestAria')}
        >
          {t('browseAsGuest')}
        </motion.button>
      </motion.div>
    </div>
  )
}
