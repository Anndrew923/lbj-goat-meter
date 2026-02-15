import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'
import UserProfileSetup from '../components/UserProfileSetup'
import VotingArena from '../components/VotingArena'
import AnalystGate from '../components/AnalystGate'
import SentimentStats from '../components/SentimentStats'
import AnalyticsDashboard from '../components/AnalyticsDashboard'
import FilterFunnel from '../components/FilterFunnel'
import LiveTicker from '../components/LiveTicker'
import PulseMap from '../components/PulseMap'
import { motion } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'

export default function VotePage() {
  const { currentUser, isGuest, signOut } = useAuth()
  const navigate = useNavigate()
  const [showProfileSetup, setShowProfileSetup] = useState(false)
  const [profileChecked, setProfileChecked] = useState(false)
  const [filters, setFilters] = useState({})
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const stableFilters = useMemo(() => ({ ...filters }), [filters])

  useEffect(() => {
    if (!currentUser?.uid) return
    getDoc(doc(db, 'profiles', currentUser.uid))
      .then((snap) => {
        if (!snap.exists()) setShowProfileSetup(true)
      })
      .catch(() => {
        // 權限或網路錯誤時仍標記已檢查，避免畫面卡住；可選擇不彈出 Modal 或彈出讓用戶重試
      })
      .finally(() => setProfileChecked(true))
  }, [currentUser?.uid])

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
            <button
              type="button"
              onClick={signOut}
              className="text-sm text-villain-purple hover:underline"
            >
              登出
            </button>
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

      {profileChecked && (
        <UserProfileSetup
          open={showProfileSetup}
          onClose={() => setShowProfileSetup(false)}
          userId={currentUser?.uid}
          onSaved={() => setShowProfileSetup(false)}
        />
      )}
    </div>
  )
}
