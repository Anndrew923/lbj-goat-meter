import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * 需登入才能進入的路由包裝組件。
 * 未登入時導向 / 登入頁，並在登入完成後可導回原目標（state.from）。
 */
export default function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth()
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

  if (!currentUser) {
    return <Navigate to="/" state={{ from: location }} replace />
  }

  return children
}
