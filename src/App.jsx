import { useState, useEffect, useRef, useCallback } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { PushNotifications } from '@capacitor/push-notifications'
import { useAuth } from './context/AuthContext'
import { BreakingVoteProvider } from './context/BreakingVoteContext'
import { saveFCMToken } from './services/AccountService'
import LoginPage from './pages/LoginPage'
import VotePage from './pages/VotePage'
import SetupPage from './pages/SetupPage'
import PrivacyPage from './pages/PrivacyPage'
import UniversalAdmin from './pages/UniversalAdmin'
import BreakingHistoryPage from './pages/BreakingHistoryPage'
import BattleCardExportScene from './pages/BattleCardExportScene'
import RenderStudioPage from './pages/RenderStudioPage'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import ExitConfirmModal from './components/ExitConfirmModal'
import RecaptchaDisclosure from './components/RecaptchaDisclosure'
import { triggerHaptic } from './utils/hapticUtils'
import { initializeAdMob } from './services/AdMobService'

const TOAST_DURATION_MS = 2500
const DOUBLE_BACK_WINDOW_MS = 2000
const DEEP_LINK_PENDING_KEY = 'pending_warzone_id'
const LBJ_WARZONE_ID = 'LAL'

const toastStyle = {
  position: 'fixed',
  bottom: 'max(var(--safe-bottom), 24px)',
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
  const { currentUser, hasProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [toastMessage, setToastMessage] = useState('')
  const [isExitModalOpen, setIsExitModalOpen] = useState(false)
  const [isAppReady, setIsAppReady] = useState(false)
  const lastBackPressRef = useRef(0)
  const pathnameRef = useRef(location.pathname)
  const exitModalOpenRef = useRef(isExitModalOpen)
  const pendingWarzoneRef = useRef(null)

  pathnameRef.current = location.pathname
  exitModalOpenRef.current = isExitModalOpen
  const isBattleCardExportScene = location.pathname === '/battlecard-export'
  const isRenderStudioScene =
    location.pathname === '/render-studio' || location.pathname.startsWith('/render-studio/')

  useEffect(() => {
    initializeAdMob().catch(() => {})
  }, [])

  useEffect(() => {
    setIsAppReady(true)
  }, [])

  const resolveWarzoneIdFromUrl = useCallback((rawUrl) => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return ''
    try {
      const parsed = new URL(rawUrl)
      // 主菜導流：不論外部帶入何種戰區參數，一律收斂至 LBJ 主戰區。
      if (parsed.protocol !== 'lbj-goat-meter:') return ''
      if (parsed.hostname !== 'vote') return ''
      return LBJ_WARZONE_ID
    } catch {
      return ''
    }
  }, [])

  const routeToWarzone = useCallback(
    (warzoneId) => {
      const normalized = typeof warzoneId === 'string' ? warzoneId.trim() : ''
      if (!normalized) return
      navigate(`/vote?warzoneId=${encodeURIComponent(normalized)}`, { replace: true })
    },
    [navigate]
  )

  // Deferred Deep Link：監聽 appUrlOpen 與冷啟動 URL，萃取 warzoneId 後導向戰區頁。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handleUrl = (url) => {
      const warzoneId = resolveWarzoneIdFromUrl(url)
      if (!warzoneId) return
      // 冷啟動時 Router 尚未穩定可導頁，先暫存深層連結，待 App ready 後再消化。
      if (!isAppReady) {
        pendingWarzoneRef.current = warzoneId
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(DEEP_LINK_PENDING_KEY, warzoneId)
        }
        return
      }
      if (currentUser?.uid) {
        routeToWarzone(warzoneId)
        return
      }
      pendingWarzoneRef.current = warzoneId
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DEEP_LINK_PENDING_KEY, warzoneId)
      }
    }

    CapApp.getLaunchUrl()
      .then((launchData) => handleUrl(launchData?.url))
      .catch(() => {})

    const listenerPromise = CapApp.addListener('appUrlOpen', ({ url }) => handleUrl(url))
    return () => {
      listenerPromise.then((listener) => listener.remove())
    }
  }, [currentUser?.uid, isAppReady, resolveWarzoneIdFromUrl, routeToWarzone])

  // 使用者登入後消化延遲深層連結，確保廣告點擊後可「所點即所得」進入指定戰區。
  useEffect(() => {
    if (!isAppReady || !currentUser?.uid) return
    const memoryPending = pendingWarzoneRef.current
    const storagePending =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem(DEEP_LINK_PENDING_KEY) || ''
        : ''
    const pendingWarzoneId = (memoryPending || storagePending || '').trim()
    if (!pendingWarzoneId) return
    routeToWarzone(pendingWarzoneId)
    pendingWarzoneRef.current = null
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(DEEP_LINK_PENDING_KEY)
    }
  }, [currentUser?.uid, isAppReady, routeToWarzone])

  // 戰況即時快報：僅在原生平台、已登入且 profile 已存在時請求推播權限並註冊（避免 updateDoc 時 profile 尚未建立）
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !currentUser || !hasProfile) return

    const setupPush = async () => {
      let perm = await PushNotifications.checkPermissions()
      if (perm.receive === 'prompt') {
        perm = await PushNotifications.requestPermissions()
      }
      if (perm.receive === 'granted') {
        await PushNotifications.register()
      }
    }

    setupPush().catch((err) => {
      if (import.meta.env.DEV) console.warn('[App] setupPush:', err?.message)
    })

    const registrationHandler = PushNotifications.addListener(
      'registration',
      (token) => {
        saveFCMToken(currentUser.uid, token.value).catch((err) => {
          if (import.meta.env.DEV) console.warn('[App] saveFCMToken:', err?.message)
        })
      }
    )

    return () => {
      registrationHandler.then((listener) => listener.remove())
    }
    // 僅依賴 uid / hasProfile，故意不列 currentUser 避免物件參照變動導致重複註冊
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, hasProfile])

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
      // 其他頁（/breaking-history、/setup、/privacy 等）：返回鍵回到投票頁，確保 Android 物理返回鍵行為一致
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
      <BreakingVoteProvider>
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
        <Route
          path="/breaking-history"
          element={
            <ProtectedRoute>
              <BreakingHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <UniversalAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/battlecard-export"
          element={
            <ProtectedRoute>
              <BattleCardExportScene />
            </ProtectedRoute>
          }
        />
        <Route path="/render-studio" element={<RenderStudioPage />} />
        <Route path="/render-studio/:jobId" element={<RenderStudioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </BreakingVoteProvider>
      {!isBattleCardExportScene && !isRenderStudioScene && toastMessage && (
        <div role="status" aria-live="polite" style={toastStyle}>
          {toastMessage}
        </div>
      )}
      {!isBattleCardExportScene && !isRenderStudioScene ? (
        <>
          <ExitConfirmModal
            open={isExitModalOpen}
            onClose={() => setIsExitModalOpen(false)}
          />
          <RecaptchaDisclosure />
        </>
      ) : null}
    </>
  )
}
