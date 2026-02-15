import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import UserProfileSetup from '../components/UserProfileSetup'
import VotingArena from '../components/VotingArena'
import AnalystGate from '../components/AnalystGate'
import SentimentStats from '../components/SentimentStats'
import AnalyticsDashboard from '../components/AnalyticsDashboard'
import FilterFunnel from '../components/FilterFunnel'
import LiveTicker from '../components/LiveTicker'
import PulseMap from '../components/PulseMap'
import { motion, AnimatePresence } from 'framer-motion'
import { SlidersHorizontal, Settings, AlertTriangle } from 'lucide-react'

export default function VotePage() {
  const { currentUser, isGuest, signOut, deleteAccount, hasProfile, profileLoading, authError, clearAuthError } = useAuth()
  const navigate = useNavigate()
  const [profileSetupDismissed, setProfileSetupDismissed] = useState(false)
  const [filters, setFilters] = useState({})
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const stableFilters = useMemo(() => ({ ...filters }), [filters])

  // 換帳號或重新登入時重置「已關閉」狀態，讓新使用者有機會看到戰區登錄 Modal
  useEffect(() => {
    setProfileSetupDismissed(false)
  }, [currentUser?.uid])

  // 依 Context 實時 hasProfile：已登入且 profile 已載入完畢仍無文件時，顯示戰區登錄 Modal
  const needProfileSetup =
    Boolean(currentUser?.uid) && !profileLoading && !hasProfile
  const showProfileSetup = needProfileSetup && !profileSetupDismissed

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-between items-center border-b border-villain-purple/30 pb-4"
      >
        <h1 className="text-2xl font-bold text-king-gold">投票戰場</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {isGuest ? '訪客' : (currentUser?.displayName ?? currentUser?.email)}
          </span>
          {isGuest ? (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-sm text-king-gold hover:underline"
            >
              登入
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-king-gold"
                aria-label="開啟設定"
              >
                <Settings className="w-4 h-4" />
                設定
              </button>
              <button
                type="button"
                onClick={signOut}
                className="text-sm text-villain-purple hover:underline"
              >
                登出
              </button>
            </>
          )}
        </div>
      </motion.header>
      <LiveTicker />
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-8 space-y-8"
      >
        <VotingArena userId={currentUser?.uid} currentUser={currentUser} />
        <section>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-lg font-semibold text-king-gold">全球情緒統計</h2>
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-villain-purple/40 text-sm text-gray-300 hover:text-king-gold hover:border-king-gold/50"
              aria-label="開啟篩選"
            >
              <SlidersHorizontal className="w-4 h-4" />
              篩選
            </button>
          </div>
          <FilterFunnel
            open={filterDrawerOpen}
            onClose={() => setFilterDrawerOpen(false)}
            filters={stableFilters}
            onFiltersChange={setFilters}
          />
          <AnalystGate>
            <div className="mb-6">
              <PulseMap filters={stableFilters} onFiltersChange={setFilters} />
            </div>
            <SentimentStats filters={stableFilters} />
            <div className="mt-6">
              <AnalyticsDashboard filters={stableFilters} />
            </div>
          </AnalystGate>
        </section>
      </motion.main>

      {currentUser?.uid && (
        <UserProfileSetup
          open={showProfileSetup}
          onClose={() => setProfileSetupDismissed(true)}
          userId={currentUser?.uid}
          onSaved={() => setProfileSetupDismissed(true)}
        />
      )}

      {/* 使用者設定區：底部為 Danger Zone（帳號刪除），符合 Google Play 合規與資料隱私透明度 */}
      <AnimatePresence>
        {settingsOpen && !isGuest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { setSettingsOpen(false); clearAuthError() }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full max-w-lg rounded-t-2xl border-t border-villain-purple/30 bg-gray-900 p-6 pb-safe"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 id="settings-title" className="text-lg font-bold text-king-gold">設定</h2>
                <button
                  type="button"
                  onClick={() => { setSettingsOpen(false); clearAuthError() }}
                  className="text-gray-400 hover:text-white"
                >
                  關閉
                </button>
              </div>
              {authError && (
                <p className="mb-4 text-sm text-red-400" role="alert">{authError}</p>
              )}
              {/* Danger Zone：半透明黑底、紅色警告按鈕，二次確認後執行刪除 */}
              <section className="mt-8 pt-6 border-t border-red-900/50">
                <p className="text-xs uppercase tracking-wider text-red-400/90 font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" aria-hidden />
                  Danger Zone
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  刪除帳號後，您的戰區資料與投票紀錄將永久移除且無法復原。
                </p>
                <button
                  type="button"
                  onClick={() => { setSettingsOpen(false); setDeleteConfirmOpen(true) }}
                  className="w-full py-3 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 border border-red-500/50"
                >
                  刪除帳號
                </button>
              </section>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 二次確認彈窗：半透明黑色遮罩、明顯紅色警告按鈕 */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            onClick={() => {
              if (!deleting) {
                setDeleteConfirmOpen(false)
                clearAuthError()
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl border border-red-900/60 bg-gray-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-confirm-title" className="text-lg font-bold text-red-400 mb-2">
                確定要刪除帳號？
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                此操作無法復原，所有戰區與投票資料將永久刪除。
              </p>
              {authError && (
                <p className="mb-4 text-sm text-red-400" role="alert">
                  {authError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setDeleteConfirmOpen(false); clearAuthError() }}
                  className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setDeleting(true)
                    clearAuthError()
                    try {
                      await deleteAccount()
                    } catch {
                      // 錯誤已由 AuthContext 寫入 authError，保留彈窗讓用戶閱讀後自行關閉
                    } finally {
                      setDeleting(false)
                    }
                  }}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deleting ? '刪除中…' : '永久刪除'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
