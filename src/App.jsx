import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LoginPage from './pages/LoginPage'
import VotePage from './pages/VotePage'
import SetupPage from './pages/SetupPage'
import PrivacyPage from './pages/PrivacyPage'
import ProtectedRoute from './components/ProtectedRoute'
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
  const [toastMessage, setToastMessage] = useState('')
  const lastBackPressRef = useRef(0)

  useEffect(() => {
    initializeAdMob().catch(() => {})
  }, [])

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
    </>
  )
}
