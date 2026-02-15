import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const { currentUser, loading, authError, loginWithGoogle, clearAuthError, continueAsGuest } =
    useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  useEffect(() => {
    if (loading) return
    if (currentUser) {
      const from = location.state?.from?.pathname ?? '/vote'
      navigate(from, { replace: true })
    }
  }, [currentUser, loading, navigate, location.state?.from?.pathname])

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
          載入中…
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
          <p className="text-villain-purple/90 text-sm mb-6">誰才是真正的 GOAT？</p>
          <div
            className="w-24 h-32 rounded-lg bg-gradient-to-b from-king-gold/30 to-villain-purple/30 border border-king-gold/50"
            aria-hidden
            style={{
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            }}
          />
        </div>

        {authError && (
          <p className="mb-4 text-red-400 text-sm" role="alert">
            {authError}
          </p>
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
          {isLoggingIn ? '登入中…' : '使用 Google 登入'}
        </motion.button>

        {/* 按鈕 B：不留名參觀，較小樣式 */}
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-300 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
          onClick={handleGuest}
          aria-label="不留名參觀"
        >
          不留名參觀 (Browse as Guest)
        </motion.button>
      </motion.div>
    </div>
  )
}
