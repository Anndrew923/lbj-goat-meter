import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * 需登入或訪客才能進入的路由包裝組件。
 * 寬鬆策略：currentUser 存在或 isGuest 為 true 皆可進入主頁；
 * 未登入且非訪客時導向 / 登入頁，登入完成後可導回原目標（state.from）。
 */
export default function ProtectedRoute({ children }) {
  const { currentUser, isGuest, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-king-gold animate-pulse" role="status" aria-live="polite">
          驗證中…
        </p>
      </div>
    )
  }

  if (!currentUser && !isGuest) {
    return <Navigate to="/" state={{ from: location }} replace />
  }

  return children
}
