import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import LoginPage from './pages/LoginPage'
import VotePage from './pages/VotePage'
import SetupPage from './pages/SetupPage'
import PrivacyPage from './pages/PrivacyPage'
import ProtectedRoute from './components/ProtectedRoute'
import ExitConfirmModal from './components/ExitConfirmModal'
import RecaptchaDisclosure from './components/RecaptchaDisclosure'
import { triggerHaptic } from './utils/hapticUtils'
import { initializeAdMob } from './services/AdMobService'

const TOAST_DURATION_MS = 2500
const DOUBLE_BACK_WINDOW_MS = 2000

const toastStyle = {
  position: 'fixed',
  bottom: 'max(env(safe-area-inset-bottom), 24px)',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 20px',
  borderRadius: '8px',
  background: 'rgba(0,0,0,0.85)',
  color: '#fff',
  fontSize: '14px',
  whiteSpace: 'nowrap',
  maxWidth: 'calc(100vw - 32px)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  zIndex: 9999,
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
}

export default function App() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  const [toastMessage, setToastMessage] = useState('')
  const [isExitModalOpen, setIsExitModalOpen] = useState(false)
  const lastBackPressRef = useRef(0)
  const pathnameRef = useRef(location.pathname)
  const exitModalOpenRef = useRef(isExitModalOpen)

  pathnameRef.current = location.pathname
  exitModalOpenRef.current = isExitModalOpen

  useEffect(() => {
    initializeAdMob().catch(() => {})
  }, [])

  // 原生返回鍵：僅在 Capacitor 原生平台註冊，攔截返回並依路由/Modal 狀態處理
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handler = () => {
      const pathname = pathnameRef.current
      const modalOpen = exitModalOpenRef.current

      if (modalOpen) {
        CapApp.exitApp()
        return
      }
      // 登入頁 '/' 或投票頁 '/vote'：按返回鍵直接喚起離開 Modal（'/' 時若先 navigate('/vote') 會被 ProtectedRoute 踢回造成死循環）
      if (pathname === '/' || pathname === '/vote') {
        triggerHaptic(30)
        setIsExitModalOpen(true)
        return
      }
      // 其他頁（如 /setup、/privacy）：返回鍵先回投票頁
      navigate('/vote', { replace: true })
    }

    const listenerPromise = CapApp.addListener('backButton', handler)
    return () => {
      listenerPromise.then((l) => l.remove())
    }
  }, [navigate])

  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    if (!isMobile) return

    const handlePopState = () => {
      const now = Date.now()
      if (now - lastBackPressRef.current < DOUBLE_BACK_WINDOW_MS) {
        return
      }
      lastBackPressRef.current = now
      triggerHaptic(30)
      setToastMessage(t('exitBattlefieldWarning'))
      window.history.forward()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [t])

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(''), TOAST_DURATION_MS)
    return () => clearTimeout(id)
  }, [toastMessage])

  return (
    <>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route
          path="/vote"
          element={
            <ProtectedRoute>
              <VotePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/setup"
          element={
            <ProtectedRoute>
              <SetupPage />
            </ProtectedRoute>
          }
        />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {toastMessage && (
        <div role="status" aria-live="polite" style={toastStyle}>
          {toastMessage}
        </div>
      )}
      <ExitConfirmModal
        open={isExitModalOpen}
        onClose={() => setIsExitModalOpen(false)}
      />
      <RecaptchaDisclosure />
    </>
  )
}
