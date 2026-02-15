/**
 * VotingArena — 投票競技場（暗黑競技風）
 * 六大立場選擇、依立場動態原因標籤雲、Framer Motion 動畫（GOAT 金閃／Villain 紫碎）。
 * 提交前檢查 profile.hasVoted；提交使用 Firestore Transaction 同步寫入 votes 並更新 profiles.hasVoted。
 */
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { STANCES, REASONS_BY_STANCE } from '../lib/constants'
import BattleCard from './BattleCard'
import LoginPromptModal from './LoginPromptModal'

const STAR_ID = 'lbj'

function getReasonLabels(stance, reasonValues) {
  const list = REASONS_BY_STANCE[stance] ?? []
  return reasonValues.map((v) => list.find((r) => r.value === v)?.label ?? v)
}

export default function VotingArena({ userId, currentUser }) {
  const { isGuest } = useAuth()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [selectedStance, setSelectedStance] = useState(null)
  const [selectedReasons, setSelectedReasons] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [voteSuccess, setVoteSuccess] = useState(false)
  const [showBattleCard, setShowBattleCard] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [goatFlash, setGoatFlash] = useState(false)
  const [villainShatter, setVillainShatter] = useState(false)
  const animationTimeouts = useRef([])

  useEffect(() => {
    return () => animationTimeouts.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    getDoc(doc(db, 'profiles', userId))
      .then((snap) => setProfile(snap.exists() ? snap.data() : null))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false))
  }, [userId])

  useEffect(() => {
    setSelectedReasons([])
  }, [selectedStance])

  const toggleReason = (value) => {
    setSelectedReasons((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    )
  }

  const hasVoted = profile?.hasVoted === true
  const canSubmit = profile && !hasVoted && selectedStance && selectedReasons.length > 0

  const handleStanceSelect = (value) => {
    // 訪客點擊立場時攔截，顯示登入提示而非進入原因選擇或提交
    if (isGuest) {
      setShowLoginPrompt(true)
      return
    }
    animationTimeouts.current.forEach(clearTimeout)
    animationTimeouts.current = []
    if (value === 'goat') {
      setGoatFlash(true)
      animationTimeouts.current.push(setTimeout(() => setGoatFlash(false), 600))
    } else if (value === 'villain') {
      setVillainShatter(true)
      animationTimeouts.current.push(setTimeout(() => setVillainShatter(false), 800))
    }
    setSelectedStance(value)
  }

  const handleSubmit = async () => {
    if (!userId || !canSubmit || !profile) return
    setSubmitting(true)
    setSubmitError(null)
    const profileRef = doc(db, 'profiles', userId)
    const votesRef = collection(db, 'votes')

    try {
      await runTransaction(db, async (tx) => {
        const profileSnap = await tx.get(profileRef)
        if (!profileSnap.exists()) throw new Error('請先完成戰區登錄')
        const data = profileSnap.data()
        if (data.hasVoted === true) throw new Error('您已投過票')

        const votePayload = {
          starId: STAR_ID,
          userId,
          status: selectedStance,
          reasons: selectedReasons,
          voterTeam: data.voterTeam ?? '',
          ageGroup: data.ageGroup ?? '',
          gender: data.gender ?? '',
          country: data.country ?? '',
          city: data.city ?? '',
          createdAt: serverTimestamp(),
        }
        const newVoteRef = doc(votesRef)
        tx.set(newVoteRef, votePayload)
        tx.update(profileRef, {
          hasVoted: true,
          updatedAt: serverTimestamp(),
        })
      })
      setVoteSuccess(true)
      setShowBattleCard(true)
      setProfile((prev) => (prev ? { ...prev, hasVoted: true } : null))
    } catch (err) {
      setSubmitError(err?.message ?? '提交失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  // 僅在「有 userId 且尚在載入」時顯示載入；訪客無 userId 不閃爍載入中
  if (profileLoading && userId) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">載入戰區…</p>
      </div>
    )
  }

  if (!profile && !isGuest) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-gray-400">請先完成戰區登錄再參與投票。</p>
      </div>
    )
  }

  // 訪客：僅顯示立場按鈕，點擊時由 handleStanceSelect 觸發 LoginPromptModal
  if (isGuest) {
    return (
      <>
        <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
          <h3 className="text-lg font-bold text-king-gold mb-2">選擇你的立場</h3>
          <p className="text-sm text-gray-500 mb-4">登入後即可投票並領取專屬戰報卡</p>
          <div className="flex flex-wrap gap-2">
            {STANCES.map(({ value, label, theme }) => (
              <motion.button
                key={value}
                type="button"
                onClick={() => handleStanceSelect(value)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                  theme === 'king-gold'
                    ? 'bg-gray-800 text-king-gold border border-king-gold/50 hover:bg-king-gold/20'
                    : theme === 'villain-purple'
                      ? 'bg-gray-800 text-villain-purple border border-villain-purple/50 hover:bg-villain-purple/20'
                      : 'bg-gray-800 text-gray-300 border border-gray-600'
                }`}
              >
                {label}
              </motion.button>
            ))}
          </div>
        </div>
        <LoginPromptModal open={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
      </>
    )
  }

  if (hasVoted || voteSuccess) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-king-gold/40 bg-gray-900/80 p-8 text-center"
        >
          <p className="text-king-gold font-semibold">您已投過票</p>
          <p className="mt-2 text-sm text-gray-400">感謝您的立場，數據將納入全球統計。</p>
        </motion.div>
        <BattleCard
          open={showBattleCard}
          onClose={() => setShowBattleCard(false)}
          photoURL={currentUser?.photoURL}
          displayName={currentUser?.displayName ?? currentUser?.email}
          voterTeam={profile?.voterTeam}
          status={selectedStance}
          reasonLabels={getReasonLabels(selectedStance, selectedReasons)}
          city={profile?.city}
          country={profile?.country}
          rankLabel={profile?.city ? `${profile.city} · 專屬戰報` : '專屬戰報'}
        />
      </>
    )
  }

  const reasons = selectedStance ? (REASONS_BY_STANCE[selectedStance] ?? []) : []
  const isVillainStance = selectedStance === 'villain' || selectedStance === 'decider'

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
      <h3 className="text-lg font-bold text-king-gold mb-4">選擇你的立場</h3>

      {/* 六大立場按鈕 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STANCES.map(({ value, label, theme }) => (
          <motion.button
            key={value}
            type="button"
            onClick={() => handleStanceSelect(value)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`relative px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
              selectedStance === value
                ? theme === 'king-gold'
                  ? 'bg-king-gold text-black shadow-lg shadow-king-gold/40'
                  : theme === 'villain-purple'
                    ? 'bg-villain-purple text-white shadow-lg shadow-villain-purple/40'
                    : 'bg-gray-500 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {value === 'goat' && goatFlash && (
              <motion.span
                className="absolute inset-0 rounded-lg bg-king-gold"
                initial={{ opacity: 0.8, scale: 0.8 }}
                animate={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 0.5 }}
                style={{ boxShadow: '0 0 24px rgba(212,175,55,0.8)' }}
              />
            )}
            {value === 'villain' && villainShatter && (
              <motion.span
                className="absolute inset-0 rounded-lg bg-villain-purple"
                initial={{ opacity: 1, scale: 1 }}
                animate={{ opacity: 0, scale: 1.2 }}
                transition={{ duration: 0.4 }}
                style={{
                  boxShadow: '0 0 20px rgba(75,0,130,0.9), inset 0 0 20px rgba(0,0,0,0.5)',
                  filter: 'brightness(1.3)',
                }}
              />
            )}
            <span className="relative z-0">{label}</span>
          </motion.button>
        ))}
      </div>

      {/* 原因標籤雲（依所選立場動態顯示） */}
      <AnimatePresence mode="wait">
        {selectedStance && (
          <motion.div
            key={selectedStance}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-6"
          >
            <p className="text-sm text-gray-400 mb-2">選擇原因（可複選）</p>
            <div className="flex flex-wrap gap-2">
              {reasons.map(({ value, label }) => (
                <motion.button
                  key={value}
                  type="button"
                  onClick={() => toggleReason(value)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedReasons.includes(value)
                      ? isVillainStance
                        ? 'bg-villain-purple/70 text-white'
                        : 'bg-king-gold/80 text-black'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {submitError && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {submitError}
        </p>
      )}

      <motion.button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        whileHover={canSubmit ? { scale: 1.02 } : {}}
        whileTap={canSubmit ? { scale: 0.98 } : {}}
        className="w-full py-3 rounded-lg bg-king-gold text-black font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? '提交中…' : '投下神聖一票'}
      </motion.button>
    </div>
  )
}
