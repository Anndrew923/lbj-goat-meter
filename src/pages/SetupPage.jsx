import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import UserProfileSetup from '../components/UserProfileSetup'

/**
 * /setup — 戰區登錄專頁。僅在已登入且尚無 profile 時顯示；
 * 完成後導向 /vote。
 */
export default function SetupPage() {
  const { t } = useTranslation('common')
  const { currentUser, profileLoading, hasProfile } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (profileLoading) return
    if (!currentUser?.uid) {
      navigate('/', { replace: true })
      return
    }
    if (hasProfile) {
      navigate('/vote', { replace: true })
    }
  }, [currentUser?.uid, profileLoading, hasProfile, navigate])

  if (profileLoading || hasProfile) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-king-gold animate-pulse" role="status" aria-live="polite">
          {t('loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <UserProfileSetup
        open={true}
        onClose={() => navigate('/vote', { replace: true })}
        userId={currentUser?.uid}
        onSaved={() => navigate('/vote', { replace: true })}
      />
    </div>
  )
}
