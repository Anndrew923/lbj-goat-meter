/**
 * AdminRoute — 僅限指定管理員信箱進入的路由包裝
 *
 * 設計意圖：
 * - /admin 需嚴格限權，僅 topaj01@gmail.com 可進入，避免一般登入用戶誤觸或濫用。
 * - 未登入或非管理員時導向登入頁（未登入）或投票頁（已登入但非管理員）。
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { isFirebaseReady } from '../lib/firebase'

// 若變更管理員信箱，請同步更新 firestore.rules 的 isBreakingWarzoneAdmin()
const ADMIN_EMAIL = 'topaj01@gmail.com'

export default function AdminRoute({ children }) {
  const { t } = useTranslation('common')
  const { currentUser, loading } = useAuth()
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

  if (!currentUser) {
    const from = { pathname: typeof pathname === 'string' ? pathname : '/admin' }
    return <Navigate to="/" state={{ from }} replace />
  }

  const email = (currentUser.email || '').trim().toLowerCase()
  if (email !== ADMIN_EMAIL.toLowerCase()) {
    if (import.meta.env.DEV) {
      console.log('[AdminRoute] Redirecting: not admin', { email })
    }
    return <Navigate to="/vote" replace />
  }

  return children
}
