import { Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { isFirebaseReady } from '../lib/firebase'

/**
 * 需登入或訪客才能進入的路由包裝組件。
 * 寬鬆策略：currentUser 存在或 isGuest 為 true 皆可進入主頁；
 * 未登入且非訪客時導向 / 登入頁，並將當前 pathname 存入 state.from 供登入後導回。
 * 終極防護：Auth 狀態不明時（Firebase 未就緒或 loading）保持靜止，禁止導向，避免 isFirebaseReady 與 user 異步落差造成死循環。
 */
export default function ProtectedRoute({ children }) {
  const { t } = useTranslation('common')
  const { currentUser, isGuest, loading } = useAuth()
  const location = useLocation()
  const pathname = location?.pathname

  const authUnclear = !isFirebaseReady || loading

  if (authUnclear) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-king-gold animate-pulse" role="status" aria-live="polite">
          {t('verifying')}
        </p>
      </div>
    )
  }

  if (!currentUser && !isGuest) {
    if (import.meta.env.DEV) {
      console.log('[ProtectedRoute] Redirecting because not authenticated', {
        isFirebaseReady,
        loading,
        user: currentUser != null,
        isGuest,
      })
    }
    const from = { pathname: typeof pathname === 'string' ? pathname : '/vote' }
    return <Navigate to="/" state={{ from }} replace />
  }

  return children
}
