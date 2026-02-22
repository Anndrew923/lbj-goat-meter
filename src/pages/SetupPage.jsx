import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
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
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative">
      <UserProfileSetup
        open={true}
        onClose={() => navigate('/vote', { replace: true })}
        userId={currentUser?.uid}
        onSaved={() => navigate('/vote', { replace: true })}
      />
      {/* 首發過審：帳號刪除能見度 — 滿足 Apple 對具備帳號功能 App 之要求，刪除按鈕位於投票頁設定 → Danger Zone */}
      <div className="absolute bottom-20 left-4 right-4 flex flex-col items-center gap-2">
        <p className="text-xs text-gray-500 text-center">
          {t('deleteAccountHintSetup')}
        </p>
        <Link
          to="/vote"
          className="py-2 px-4 rounded-lg text-sm font-medium border border-red-900/60 text-red-400/90 hover:bg-red-950/40"
          aria-label={t('goToVotePage')}
        >
          {t('goToVotePage')}
        </Link>
      </div>
      {/* 首發過審：強制性免責聲明，與登入頁一致 */}
      <p className="absolute bottom-6 left-4 right-4 text-[10px] text-gray-500 text-center leading-relaxed" role="contentinfo">
        {t('disclaimerCommunity')}
      </p>
    </div>
  )
}
