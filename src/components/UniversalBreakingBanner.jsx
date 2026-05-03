/**
 * UniversalBreakingBanner — 突發戰區通用入口
 *
 * 設計意圖：
 * - 跨專案通用：從 global_events 讀取 target_app 包含當前專案 ID 的活動，投票前／投票後皆顯示。
 * - 動態雙語：標題、描述、選項自 Firestore 語系物件提取，依 useTranslation 語系渲染，缺語系時 fallback 到 en。
 * - 暗黑競技風：金/紫邊框、16:9 圖區。圖片 URL 與雙語內容存於同一 Document。
 * - 已投狀態由 BreakingVoteContext 提供，路由切換（首頁 ↔ 戰區）不丟失。
 */
import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap } from 'lucide-react'
import { useGlobalBreakingEvents } from '../hooks/useGlobalBreakingEvents'
import { useBreakingVote } from '../context/BreakingVoteContext'
import { useAuth } from '../context/AuthContext'
import { PROJECT_APP_ID } from '../lib/appConfig'
import { getLocalizedText } from '../lib/localeUtils'
import { getDeviceId } from '../utils/deviceId'
import { getRecaptchaToken } from '../services/RecaptchaService'
import { submitBreakingVote } from '../services/VoteService'
import { requestBreakingVoteAdRewardToken } from '../services/RewardedAdsService'
import { triggerHaptic } from '../utils/hapticUtils'
import CommitmentModal from './CommitmentModal'
import BreakingOptionResultBars from './BreakingOptionResultBars'
import LoginPromptModal from './LoginPromptModal'

const ASPECT_RATIO = 16 / 9

export default function UniversalBreakingBanner({ appId = PROJECT_APP_ID }) {
  const { t, i18n } = useTranslation('common')
  const { currentUser, isGuest } = useAuth()
  const isLoggedIn = !!currentUser
  const { votedEventIds, lastVoted, markEventVoted, isFirstVoteOfDay, consumeFreeVote } = useBreakingVote()
  const { events, loading, error } = useGlobalBreakingEvents(appId)
  const lang = i18n.language || 'en'
  const [submitting, setSubmitting] = useState(null)
  const [toast, setToast] = useState(null)
  const [pending, setPending] = useState(null)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)

  /** 重入鎖：防止 Confirm 按鈕快速雙擊觸發兩次廣告 */
  const confirmInFlightRef = useRef(false)

  const openCommitmentModal = useCallback((ev, optionIndex, optionLabel) => {
    if (isGuest || !currentUser) {
      triggerHaptic([30, 50, 30])
      setShowLoginPrompt(true)
      return
    }
    if (votedEventIds.includes(ev.id)) {
      triggerHaptic(10)
      setToast(t('breakingAlreadyVoted'))
      return
    }
    if (submitting) return
    triggerHaptic(10)
    setToast(null)
    setPending({ ev, optionIndex, optionLabel })
  }, [isGuest, currentUser, t, votedEventIds, submitting])

  const closeCommitmentModal = useCallback(() => {
    if (!submitting) setPending(null)
  }, [submitting])

  const handleCommitmentConfirm = useCallback(
    async () => {
      if (!pending) return
      // 重入鎖：防止快速雙擊 Confirm 觸發兩次廣告與兩次投票請求
      if (confirmInFlightRef.current) return
      confirmInFlightRef.current = true

      // 按下確認時立即消耗免費票資格（不等投票成功）
      // isFirstVoteOfDay 在 consumeFreeVote() 後的下一次 render 變 false，
      // 確保跨組件（banner/history 頁）都能即時反映。
      const isThisVoteFree = isFirstVoteOfDay
      consumeFreeVote()

      const { ev, optionIndex } = pending
      setSubmitting(`${ev.id}-${optionIndex}`)
      try {
        const deviceId = getDeviceId()
        const recaptchaToken = await getRecaptchaToken('submit_breaking_vote')
        const getMessage = (k) => t(k.replace(/^common:/, ''))
        let adRewardToken = null
        if (!isThisVoteFree) {
          adRewardToken = await requestBreakingVoteAdRewardToken()
        }
        await submitBreakingVote(
          ev.id,
          optionIndex,
          deviceId,
          recaptchaToken,
          getMessage,
          adRewardToken
        )
        markEventVoted(ev.id, optionIndex)
        setToast(t('breakingVoteSuccess'))
        setPending(null)
      } catch (err) {
        setToast(err?.message || t('breakingVoteError'))
      } finally {
        setSubmitting(null)
        confirmInFlightRef.current = false
      }
    },
    [pending, t, markEventVoted, isFirstVoteOfDay, consumeFreeVote]
  )

  if (loading) {
    return (
      <div
        className="rounded-xl border border-villain-purple/20 bg-gray-900/50 px-4 py-3 text-center"
        role="status"
        aria-label={t('breakingLoading')}
      >
        <p className="text-sm text-gray-500 animate-pulse">{t('breakingLoading')}</p>
      </div>
    )
  }

  if (error || !events?.length) {
    return null
  }

  // 首頁僅顯示最新一則話題，其餘引導至 /breaking-history
  const displayEvents = events.slice(0, 1)

  return (
    <div className="space-y-3">
      {displayEvents.map((ev) => {
        const titleText = getLocalizedText(ev.title, lang)
        const descText = getLocalizedText(ev.description, lang)
        const optionsList = Array.isArray(ev.options) ? ev.options : []
        const voted = votedEventIds.includes(ev.id)
        const displayOptions = optionsList.length > 4 ? optionsList.slice(0, 8) : optionsList.slice(0, 4)
        const displayOptionsWithLabels = displayOptions.map((opt) => ({
          label: typeof opt === 'object' && opt !== null ? getLocalizedText(opt, lang) : String(opt ?? ''),
        }))
        const optimisticOptionIndex =
          voted && lastVoted?.eventId === ev.id ? lastVoted.optionIndex : undefined

        return (
          <div
            key={ev.id}
            className="rounded-xl p-[2px] bg-gradient-to-r from-king-gold via-red-500 to-king-gold bg-beam animate-border-beam motion-reduce:animate-none"
          >
            <motion.article
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[10px] bg-gray-900/80 overflow-hidden shadow-lg shadow-king-gold/5"
            >
              <div
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: ASPECT_RATIO }}
              >
                {ev.image_url ? (
                  <img
                    src={ev.image_url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-king-gold/10 to-villain-purple/10">
                    <Zap className="w-10 h-10 text-king-gold/60" aria-hidden />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-600 text-[10px] font-bold text-white uppercase tracking-wider animate-pulse motion-reduce:animate-none"
                      aria-hidden
                    >
                      {t('liveTag')}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-king-gold/90 font-semibold">
                      {t('breakingTitle')}
                    </span>
                  </div>
                  <p className="text-white font-semibold text-sm line-clamp-2 mt-0.5">
                    {titleText || ''}
                  </p>
                {descText && (
                  <p className="text-gray-300 text-xs line-clamp-1 mt-0.5">
                    {descText}
                  </p>
                )}
              </div>
            </div>
            {optionsList.length > 0 && (
              <div className="px-3 pb-3 space-y-2">
                {voted ? (
                  <BreakingOptionResultBars
                    options={displayOptionsWithLabels}
                    voteCounts={ev.vote_counts ?? {}}
                    totalVotes={ev.total_votes ?? 0}
                    optimisticOptionIndex={optimisticOptionIndex}
                    isLoggedIn={isLoggedIn}
                  />
                ) : (
                  <>
                    <div
                      className={`options-buttons-grid ${
                        optionsList.length > 4 ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-2'
                      }`}
                    >
                      {displayOptionsWithLabels.map((opt, i) => {
                        if (!opt.label) return null
                        const isSubmitting = submitting === `${ev.id}-${i}`
                        const isCompact = optionsList.length > 4
                        return (
                          <motion.button
                            key={i}
                            layout
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => openCommitmentModal(ev, i, opt.label)}
                            className={`rounded-md text-king-gold border border-king-gold/30 hover:bg-king-gold/30 disabled:opacity-70 disabled:cursor-not-allowed transition-colors ${
                              isCompact
                                ? 'px-2 py-1.5 text-[11px] bg-king-gold/20'
                                : 'px-2 py-1 text-xs bg-king-gold/20'
                            }`}
                          >
                            {isSubmitting ? t('submitting') : opt.label}
                          </motion.button>
                        )
                      })}
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      <p className="text-[11px] text-gray-500" role="status">
                        {t('breakingTeaser', { count: ev.total_votes ?? 0 })}
                      </p>
                      {isFirstVoteOfDay && (
                        <p className="text-[11px] text-king-gold">
                          {t('breakingFirstVoteFreeHint')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            </motion.article>
          </div>
        )
      })}
      {toast && (
        <p className="text-xs text-king-gold mt-2" role="status">
          {toast}
        </p>
      )}
      <CommitmentModal
        open={Boolean(pending)}
        onClose={closeCommitmentModal}
        onConfirm={handleCommitmentConfirm}
        optionLabel={pending?.optionLabel ?? ''}
        loading={Boolean(submitting)}
        needsAd={!isFirstVoteOfDay}
      />
      <AnimatePresence initial={false}>
        {showLoginPrompt && (
          <LoginPromptModal
            key="breaking-banner-login-prompt"
            onClose={() => setShowLoginPrompt(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
