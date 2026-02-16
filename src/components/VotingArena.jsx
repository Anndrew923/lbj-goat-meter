/**
 * VotingArena — 投票競技場（暗黑競技風）
 * 六大立場對抗版：雙層語義（primary 大寫粗體英文 + secondary 細體中文），
 * 所有文案經 t() 讀取，禁止硬編碼；GOAT 金閃／FRAUD 紫碎動畫。
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { STANCES } from '../lib/constants'
import { getReasonsForStance, getReasonLabels } from '../i18n/i18n'
import { revokeVote } from '../services/AccountService'
import BattleCard from './BattleCard'
import LoginPromptModal from './LoginPromptModal'

const STAR_ID = 'lbj'

/** 依 theme 與選中狀態取得按鈕樣式 */
function getStanceButtonClass(theme, isSelected) {
  if (!isSelected) {
    if (theme === 'king-gold') return 'bg-gray-800 text-king-gold border border-king-gold/50 hover:bg-king-gold/20'
    if (theme === 'villain-purple') return 'bg-gray-800 text-villain-purple border border-villain-purple/50 hover:bg-villain-purple/20'
    if (theme === 'crown-red') return 'bg-gray-800 text-red-400 border border-red-500/50 hover:bg-red-500/20'
    if (theme === 'graphite') return 'bg-gray-800 text-gray-400 border border-gray-500 hover:bg-gray-600/30'
    if (theme === 'machine-silver') return 'bg-gray-800 text-gray-300 border border-gray-400/50 hover:bg-gray-400/20'
    if (theme === 'rust-copper') return 'bg-gray-800 text-amber-700 border border-amber-600/50 hover:bg-amber-600/20'
    return 'bg-gray-800 text-gray-300 border border-gray-600'
  }
  if (theme === 'king-gold') return 'bg-king-gold text-black shadow-lg shadow-king-gold/40'
  if (theme === 'villain-purple') return 'bg-villain-purple text-white shadow-lg shadow-villain-purple/40'
  if (theme === 'crown-red') return 'bg-red-600 text-white shadow-lg shadow-red-500/40'
  if (theme === 'graphite') return 'bg-gray-600 text-white shadow-lg shadow-gray-500/40'
  if (theme === 'machine-silver') return 'bg-gray-400 text-black shadow-lg shadow-gray-400/40'
  if (theme === 'rust-copper') return 'bg-amber-600 text-black shadow-lg shadow-amber-500/40'
  return 'bg-gray-500 text-white'
}

/** 原因標籤選中時是否用紫色系（反方） */
function isAntiStance(stance) {
  return stance === 'fraud' || stance === 'stat_padder' || stance === 'mercenary'
}

export default function VotingArena({ userId, currentUser }) {
  const { t } = useTranslation(['arena', 'common'])
  const { isGuest, profile, profileLoading, hasProfile } = useAuth()
  const [selectedStance, setSelectedStance] = useState(null)
  const [selectedReasons, setSelectedReasons] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [voteSuccess, setVoteSuccess] = useState(false)
  const [showBattleCard, setShowBattleCard] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [goatFlash, setGoatFlash] = useState(false)
  const [fraudShatter, setFraudShatter] = useState(false)
  const animationTimeouts = useRef([])
  const [revoking, setRevoking] = useState(false)
  const [revoteError, setRevoteError] = useState(null)
  const revoteExitRef = useRef(false)
  const [revoteCompleteKey, setRevoteCompleteKey] = useState(0)

  const hasVoted = profile?.hasVoted === true || voteSuccess
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

  useEffect(() => {
    if (hasVoted && !revoteExitRef.current) setShowBattleCard(true)
  }, [hasVoted])

  useEffect(() => {
    if (profile?.hasVoted === true && voteSuccess) setVoteSuccess(false)
  }, [profile?.hasVoted, voteSuccess])

  const toggleReason = (value) => {
    setSelectedReasons((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    )
  }

  const handleRevote = async () => {
    if (!userId || revoking) return
    setRevoteError(null)
    setRevoking(true)
    try {
      await revokeVote(userId)
      revoteExitRef.current = true
      setShowBattleCard(false)
    } catch (err) {
      const msg = err && typeof err.message === 'string' ? err.message : t('common:revoteError')
      setRevoteError(msg)
    } finally {
      setRevoking(false)
    }
  }

  const handleRevoteRetry = () => {
    setRevoteError(null)
    handleRevote()
  }

  const handleRevoteComplete = () => {
    if (revoteExitRef.current) {
      revoteExitRef.current = false
      setVoteSuccess(false)
      setSelectedStance(null)
      setSelectedReasons([])
      setRevoteCompleteKey((k) => k + 1)
    }
  }

  const handleStanceSelect = (value) => {
    if (isGuest) {
      setShowLoginPrompt(true)
      return
    }
    animationTimeouts.current.forEach(clearTimeout)
    animationTimeouts.current = []
    if (value === 'goat') {
      setGoatFlash(true)
      animationTimeouts.current.push(setTimeout(() => setGoatFlash(false), 600))
    } else if (value === 'fraud') {
      setFraudShatter(true)
      animationTimeouts.current.push(setTimeout(() => setFraudShatter(false), 800))
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
        // ========== 階段一：所有讀取（全部完成後才可寫入） ==========
        const profileSnap = await tx.get(profileRef)
        if (!profileSnap?.exists?.()) throw new Error(t('common:completeProfileFirst'))
        const data = profileSnap?.data?.() ?? {}
        if (data.hasVoted === true) throw new Error(t('common:alreadyVoted'))
        const newVoteRef = doc(votesRef)
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
        // ========== 階段二：所有寫入（此前不得再呼叫 tx.get） ==========
        tx.set(newVoteRef, votePayload)
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
    } catch (err) {
      const msg = err?.message != null && typeof err.message === 'string' ? err.message : t('common:submitError')
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (profileLoading && userId) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">{t('common:loadingArena')}</p>
      </div>
    )
  }

  if (!profile && !isGuest) {
    if (import.meta.env.DEV) {
      console.warn('[VotingArena] 顯示「請先登錄」', {
        userId,
        hasProfile,
        profileLoading,
        profileKeys: profile ? Object.keys(profile) : [],
      })
    }
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-gray-400">{t('common:completeProfileFirst')}</p>
      </div>
    )
  }

  if (isGuest) {
    return (
      <>
        <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
          <h3 className="text-lg font-bold text-king-gold mb-2">{t('common:chooseStance')}</h3>
          <p className="text-sm text-gray-500 mb-4">{t('common:loginToVoteHint')}</p>
          <div className="flex flex-wrap gap-2">
            {STANCES.map(({ value, theme }) => (
              <motion.button
                key={value}
                type="button"
                onClick={() => handleStanceSelect(value)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors flex flex-col items-center ${getStanceButtonClass(theme, false)}`}
              >
                <span className="text-sm leading-tight font-bold uppercase">{t('arena:stances.' + value + '.primary')}</span>
                <span className="text-[10px] opacity-80 mt-0.5 font-normal">{t('arena:stances.' + value + '.secondary')}</span>
              </motion.button>
            ))}
          </div>
        </div>
        <LoginPromptModal open={showLoginPrompt} onClose={() => setShowLoginPrompt(false)} />
      </>
    )
  }

  if (hasVoted) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-king-gold/40 bg-gray-900/80 p-8 text-center"
        >
          <p className="text-king-gold font-semibold">{t('common:alreadyVoted')}</p>
          <p className="mt-2 text-sm text-gray-400">{t('common:thanksVoted')}</p>
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
              onRevoteReload={handleRevoteRetry}
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
              rankLabel={profile?.city ? t('common:rankLabelWithCity', { city: profile.city }) : t('common:rankLabel')}
              exit={{ opacity: 0, scale: 0.8 }}
            />
          )}
        </AnimatePresence>
      </>
    )
  }

  const reasons = selectedStance ? getReasonsForStance(selectedStance) : []
  const anti = isAntiStance(selectedStance)

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
      <h3 className="text-lg font-bold text-king-gold mb-4">{t('common:chooseStance')}</h3>

      <motion.div
        key={revoteCompleteKey}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="flex flex-wrap gap-2 mb-6"
      >
        {STANCES.map(({ value, theme }) => (
          <motion.button
            key={value}
            type="button"
            onClick={() => handleStanceSelect(value)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`relative px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors flex flex-col items-center min-w-[4.5rem] ${getStanceButtonClass(theme, selectedStance === value)}`}
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
            {value === 'fraud' && fraudShatter && (
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
            <span className="relative z-0 text-sm leading-tight font-bold uppercase">{t('arena:stances.' + value + '.primary')}</span>
            <span className="relative z-0 text-[10px] font-normal opacity-90 mt-0.5">{t('arena:stances.' + value + '.secondary')}</span>
          </motion.button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        {selectedStance && (
          <motion.div
            key={selectedStance}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-6"
          >
            <p className="text-sm text-gray-400 mb-2">{t('common:chooseReasons')}</p>
            <div className="flex flex-wrap gap-2">
              {reasons.map(({ value, secondary }) => (
                <motion.button
                  key={value}
                  type="button"
                  onClick={() => toggleReason(value)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedReasons.includes(value)
                      ? anti
                        ? 'bg-villain-purple/70 text-white'
                        : 'bg-king-gold/80 text-black'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {secondary}
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
        {submitting ? t('common:submitting') : t('common:submitVote')}
      </motion.button>
    </div>
  )
}
