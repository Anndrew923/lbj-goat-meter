import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const { currentUser, loading, authError, loginWithGoogle, clearAuthError } = useAuth()
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
        className="text-center max-w-md"
      >
        <h1 className="text-3xl font-bold text-king-gold mb-2">GOAT Meter</h1>
        <p className="text-villain-purple/80 mb-8">登入後進入投票戰場</p>
        {authError && (
          <p className="mb-4 text-red-400 text-sm" role="alert">
            {authError}
          </p>
        )}
        <motion.button
          type="button"
          whileHover={{ scale: isLoggingIn ? 1 : 1.02 }}
          whileTap={{ scale: isLoggingIn ? 1 : 0.98 }}
          className="px-6 py-3 rounded-lg bg-king-gold text-black font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleLogin}
          disabled={isLoggingIn}
          aria-busy={isLoggingIn}
          aria-disabled={isLoggingIn}
        >
          {isLoggingIn ? '登入中…' : '使用 Google 登入'}
        </motion.button>
      </motion.div>
    </div>
  )
}
