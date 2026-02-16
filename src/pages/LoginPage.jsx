import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'

const languages = [
  { code: 'en', label: 'EN' },
  { code: 'zh-TW', label: '中文' },
]

/** 將 i18n.language 正規化為與 config SUPPORTED_LANGS 一致，供高亮比對 */
function resolveDisplayLanguage(lng) {
  if (!lng) return 'zh-TW'
  if (lng === 'zh-TW') return 'zh-TW'
  if (lng.startsWith('en')) return 'en'
  return 'zh-TW'
}

export default function LoginPage() {
  const { t, i18n } = useTranslation('common')
  const { currentUser, loading, profileLoading, hasProfile, authError, loginWithGoogle, clearAuthError, continueAsGuest } =
    useAuth()
  const navigate = useNavigate()
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const hasNavigatedRef = useRef(false)

  // 導向條件必須含 !profileLoading。分流：有 profile → /vote，無 profile → /setup。
  useEffect(() => {
    if (loading) return
    if (profileLoading) return
    if (!currentUser) {
      hasNavigatedRef.current = false
      return
    }
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    const to = hasProfile ? '/vote' : '/setup'
    navigate(to, { replace: true })
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

  /** 語言切換器 UI（與 config 持久化連動），loading 與主內容皆顯示 */
  const renderLanguageSwitcher = () => (
    <div className="absolute top-6 right-6 z-20" role="group" aria-label={t('language')}>
      <div className="flex items-center bg-black/40 backdrop-blur-md rounded-full p-1 border border-white/10 shadow-lg">
        {languages.map((lang) => {
          const isActive = resolveDisplayLanguage(i18n.language) === lang.code
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => i18n.changeLanguage(lang.code)}
              aria-pressed={isActive}
              aria-label={lang.code === 'en' ? t('lang_en') : t('lang_zhTW')}
              className={`relative px-4 py-1.5 text-sm font-bold rounded-full transition-colors duration-200 ${
                isActive ? 'text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeLangGlow"
                  className="absolute inset-0 bg-king-gold/20 border border-king-gold/50 rounded-full shadow-[0_0_15px_rgba(212,175,55,0.3)] z-0"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10">{lang.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center relative">
        {renderLanguageSwitcher()}
        <p className="text-king-gold animate-pulse" role="status" aria-live="polite">
          {t('loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative">
      {renderLanguageSwitcher()}

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
          <div
            className="relative z-30 mb-4 flex flex-col gap-2 rounded-lg bg-red-950/80 border border-red-400/50 p-4"
            role="alert"
          >
            <p className="text-red-400 text-sm font-medium">{authError}</p>
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
