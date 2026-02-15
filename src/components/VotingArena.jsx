/**
 * VotingArena — 投票競技場（暗黑競技風）
 * 六大立場選擇、依立場動態原因標籤雲、Framer Motion 動畫（GOAT 金閃／Villain 紫碎）。
 * 提交前檢查 profile.hasVoted；提交使用 Firestore Transaction 同步寫入 votes 並更新 profiles.hasVoted。
 *
 * 為何依賴 AuthContext 的「實時 profile 監聽」而非單次 getDoc？ [cite: 2026-02-11]
 * - 用戶「剛註冊完就直接進入戰場」時，profiles 文件由 UserProfileSetup 非同步寫入；
 *   若本組件僅在 mount 時做一次 getDoc（或 setTimeout(0) 單次抓取），可能當時文件尚未寫入，
 *   導致誤判為「未完成登錄」並顯示提示，且無重試機制會一直卡住。
 * - 透過 AuthContext 對 /profiles/{uid} 的 onSnapshot，資料庫一出現該文件就會即時推送到前端，
 *   hasProfile 與 profile 立即更新，UI 自動切換為六大立場按鈕，達成無縫體驗。
 */
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { STANCES, REASONS_BY_STANCE } from '../lib/constants'
import { revokeVote } from '../services/AccountService'
import BattleCard from './BattleCard'
import LoginPromptModal from './LoginPromptModal'

const STAR_ID = 'lbj'

function getReasonLabels(stance, reasonValues) {
  const list = REASONS_BY_STANCE[stance] ?? []
  return reasonValues.map((v) => list.find((r) => r.value === v)?.label ?? v)
}

export default function VotingArena({ userId, currentUser }) {
  const { isGuest, profile, profileLoading, hasProfile } = useAuth()
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
  /** 提交成功後本地暫存 hasVoted，與 Context profile 同步前避免閃爍 */
  const [localHasVoted, setLocalHasVoted] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [revoteError, setRevoteError] = useState(null)
  /** 用於 onExitComplete 時判斷是否為「重置投票」導致的關閉，以決定是否清空本地投票狀態 */
  const revoteExitRef = useRef(false)
  const [revoteCompleteKey, setRevoteCompleteKey] = useState(0)

  const hasVoted = profile?.hasVoted === true || localHasVoted
  const canSubmit = profile && !hasVoted && selectedStance && selectedReasons.length > 0

  useEffect(() => {
    return () => {
      const timeouts = animationTimeouts.current
      if (timeouts && Array.isArray(timeouts)) timeouts.forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    setSelectedReasons([])
  }, [selectedStance])

  // 已投票時自動顯示戰報卡與重置鈕（含刷新後）；重置流程中不重設，避免 exit 動畫時卡片重現
  useEffect(() => {
    if ((hasVoted || voteSuccess) && !revoteExitRef.current) {
      setShowBattleCard(true)
    }
  }, [hasVoted, voteSuccess])

  const toggleReason = (value) => {
    setSelectedReasons((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    )
  }

  /** 重新投票：無條件恢復投票權；失敗時顯示自癒選項，絕不卡在紅字畫面 */
  const handleRevote = async () => {
    if (!userId || revoking) return
    setRevoteError(null)
    setRevoking(true)
    try {
      await revokeVote(userId)
      revoteExitRef.current = true
      setShowBattleCard(false)
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : '重置時發生錯誤，請重新整理頁面後再試'
      setRevoteError(msg)
    } finally {
      setRevoking(false)
    }
  }

  /** 自癒：強制重新整理，清空快取與狀態，避免卡在錯誤畫面 */
  const handleRevoteReload = () => {
    window.location.reload()
  }

  const handleRevoteComplete = () => {
    if (revoteExitRef.current) {
      revoteExitRef.current = false
      setLocalHasVoted(false)
      setVoteSuccess(false)
      setSelectedStance(null)
      setSelectedReasons([])
      setRevoteCompleteKey((k) => k + 1)
    }
  }

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
        // 寫入即預備：同步寫入 currentVoteId（該筆投票 docId）至 profile，重置時依此精確刪除，不依賴模糊查詢
        tx.update(profileRef, {
          hasVoted: true,
          currentStance: selectedStance,
          currentReasons: selectedReasons,
          currentVoteId: newVoteRef.id,
          updatedAt: serverTimestamp(),
        })
      })
      setVoteSuccess(true)
      setShowBattleCard(true)
      setLocalHasVoted(true)
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : '提交失敗，請稍後再試'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // 依 Context 的 profile 實時狀態：有 userId 且 profile 尚在載入時顯示載入；訪客不閃爍
  if (profileLoading && userId) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">載入戰區…</p>
      </div>
    )
  }

  if (!profile && !isGuest) {
    // 防禦性日誌：資料庫已有 profiles 卻仍顯示「請先登錄」時，可依此排查缺失欄位或同步延遲
    const missing = !userId
      ? 'userId 為空'
      : !hasProfile
        ? 'hasProfile 為 false（profiles 文件尚未建立或實時監聽尚未收到）'
        : 'profile 為 null 但 hasProfile 為 true（異常）'
    if (import.meta.env.DEV) {
      console.warn('[VotingArena] 顯示「請先登錄」', {
        userId,
        hasProfile,
        profileLoading,
        profileKeys: profile ? Object.keys(profile) : [],
        缺失欄位或原因: missing,
      })
    }
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
        <AnimatePresence mode="wait" onExitComplete={handleRevoteComplete}>
          {showBattleCard && (
            <BattleCard
              key="battle-card"
              open={showBattleCard}
              onClose={() => setShowBattleCard(false)}
              onRevote={handleRevote}
              revoking={revoking}
              revoteError={revoteError}
              onRevoteReload={handleRevoteReload}
              photoURL={currentUser?.photoURL}
              displayName={currentUser?.displayName ?? currentUser?.email}
              voterTeam={profile?.voterTeam}
              status={profile?.currentStance ?? selectedStance}
              reasonLabels={getReasonLabels(
                profile?.currentStance ?? selectedStance,
                Array.isArray(profile?.currentReasons) ? profile.currentReasons : (selectedReasons ?? [])
              )}
              city={profile?.city}
              country={profile?.country}
              rankLabel={profile?.city ? `${profile.city} · 專屬戰報` : '專屬戰報'}
              exit={{ opacity: 0, scale: 0.8 }}
            />
          )}
        </AnimatePresence>
      </>
    )
  }

  const reasons = selectedStance ? (REASONS_BY_STANCE[selectedStance] ?? []) : []
  const isVillainStance = selectedStance === 'villain' || selectedStance === 'decider'

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
      <h3 className="text-lg font-bold text-king-gold mb-4">選擇你的立場</h3>

      {/* 六大立場按鈕（重置後以 key 觸發 Spring 彈射歸位） */}
      <motion.div
        key={revoteCompleteKey}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="flex flex-wrap gap-2 mb-6"
      >
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
      </motion.div>

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
