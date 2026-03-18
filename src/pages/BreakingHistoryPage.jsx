/**
 * BreakingHistoryPage — 突發戰區歷史話題列表
 *
 * 設計意圖：
 * - 使用 useGlobalBreakingEvents(..., { includeInactive: true }) 抓取所有話題（含已關閉）。
 * - 每個歷史卡片進入投票前先呼叫 RewardedAdsService 播放獎勵廣告以增加營收，再執行 submitBreakingVote。
 * - 已投狀態由 BreakingVoteContext 提供，與首頁共用，路由切換不丟失。
 */
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Zap, ArrowLeft } from 'lucide-react'
import { useGlobalBreakingEvents } from '../hooks/useGlobalBreakingEvents'
import { useBreakingVote } from '../context/BreakingVoteContext'
import { PROJECT_APP_ID } from '../lib/constants'
import { getLocalizedText } from '../lib/localeUtils'
import { getDeviceId } from '../utils/deviceId'
import { getRecaptchaToken } from '../services/RecaptchaService'
import { submitBreakingVote } from '../services/VoteService'
import { requestResetAdRewardToken } from '../services/RewardedAdsService'
import { triggerHaptic, triggerHapticImpact } from '../utils/hapticUtils'
import CommitmentModal from '../components/CommitmentModal'
import BreakingOptionResultBars from '../components/BreakingOptionResultBars'

const ASPECT_RATIO = 16 / 9

export default function BreakingHistoryPage() {
  const { t, i18n } = useTranslation('common')
  const { votedEventIds, lastVoted, markEventVoted } = useBreakingVote()
  const { events, loading, error } = useGlobalBreakingEvents(PROJECT_APP_ID, {
    includeInactive: true,
  })
  const lang = i18n.language || 'en'
  const [submitting, setSubmitting] = useState(null)
  const [toast, setToast] = useState(null)
  const [pending, setPending] = useState(null)

  // 不在戰區頁清除 lastVoted：首筆 snapshot 可能來自不同 query 的快取，若在此清除，
  // 返回首頁時首頁訂閱若仍拿到 total_votes:0 的快取就無法補正，導致票數被清空。僅由首頁 Banner 在確認 total_votes > 0 時清除。

  const openCommitmentModal = useCallback((ev, optionIndex, optionLabel) => {
    if (votedEventIds.includes(ev.id)) {
      triggerHaptic(10)
      setToast(t('breakingAlreadyVoted'))
      return
    }
    if (submitting) return
    triggerHaptic(10)
    setToast(null)
    setPending({ ev, optionIndex, optionLabel })
  }, [t, votedEventIds, submitting])

  const closeCommitmentModal = useCallback(() => {
    if (!submitting) setPending(null)
  }, [submitting])

  const handleCommitmentConfirm = useCallback(
    async () => {
      if (!pending) return
      const { ev, optionIndex } = pending
      setSubmitting(`${ev.id}-${optionIndex}`)
      try {
        await requestResetAdRewardToken()
        const deviceId = getDeviceId()
        const recaptchaToken = await getRecaptchaToken('submit_breaking_vote')
        const getMessage = (k) => t(k.replace(/^common:/, ''))
        await submitBreakingVote(ev.id, optionIndex, deviceId, recaptchaToken, getMessage)
        markEventVoted(ev.id, optionIndex)
        triggerHapticImpact()
        setToast(t('breakingVoteSuccess'))
        setPending(null)
      } catch (err) {
        const msg = err?.code === 'ad-not-watched' ? t('voteError_adNotWatched') : (err?.message || t('breakingVoteError'))
        setToast(msg)
      } finally {
        setSubmitting(null)
      }
    },
    [pending, t, markEventVoted]
  )

  return (
    <div className="min-h-screen bg-black text-white p-6 pb-safe">
      <div className="max-w-lg mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-king-gold">{t('breakingTitle')}</h1>
          <Link
            to="/vote"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-king-gold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {t('backToApp')}
          </Link>
        </header>

        {loading && (
          <p className="text-sm text-gray-500 animate-pulse" role="status">
            {t('breakingLoading')}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error?.message || t('adminError')}
          </p>
        )}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-gray-500">{t('adminNoTopics')}</p>
        )}
        {!loading && events.length > 0 && (
          <div className="relative overflow-hidden">
            {/* 進入頁面時水平掃描線動畫，播放 1 秒 */}
            <div
              className="absolute left-0 top-0 z-10 h-0.5 w-1/4 bg-gradient-to-r from-transparent via-king-gold to-transparent opacity-80 animate-scanning-line motion-reduce:animate-none pointer-events-none"
              aria-hidden
            />
            {/* 單欄列表：每張卡片保持灰階→彩色歷史解鎖儀式感，寬度撐滿 max-w-lg */}
            <div className="relative flex flex-col space-y-6">
              {events.map((ev) => {
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
                  <motion.article
                    key={ev.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full rounded-xl border border-villain-purple/30 bg-gray-900/80 overflow-hidden shadow-lg relative"
                  >
                    {/* 投票成功後：歷史存證浮水印 */}
                    {voted && (
                      <div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1]"
                        aria-hidden
                      >
                        <span
                          className="text-amber-500/50 text-sm font-bold uppercase tracking-widest whitespace-nowrap"
                          style={{ transform: 'rotate(-15deg)' }}
                        >
                          [HISTORY RECORDED]
                        </span>
                      </div>
                    )}
                    <div
                      className="relative w-full overflow-hidden"
                      style={{ aspectRatio: ASPECT_RATIO }}
                    >
                      {ev.image_url ? (
                        <img
                          src={ev.image_url}
                          alt=""
                          className="w-full h-full object-cover transition-[filter] duration-300"
                          style={
                            voted
                              ? undefined
                              : { filter: 'grayscale(80%) sepia(20%)' }
                          }
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
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-600/30 text-[10px] font-semibold text-amber-200 uppercase tracking-wider"
                            aria-hidden
                          >
                            ARCHIVE
                          </span>
                        </div>
                        <p className="text-white font-semibold text-sm line-clamp-2 mt-0.5">
                          {titleText || '—'}
                        </p>
                        {descText && (
                          <p className="text-gray-300 text-xs line-clamp-1 mt-0.5">{descText}</p>
                        )}
                      </div>
                    </div>
                  {optionsList.length > 0 && (
                    <div className="px-3 pb-3 pt-2 space-y-2">
                      {voted ? (
                        <BreakingOptionResultBars
                          options={displayOptionsWithLabels}
                          voteCounts={ev.vote_counts ?? {}}
                          totalVotes={ev.total_votes ?? 0}
                          optimisticOptionIndex={optimisticOptionIndex}
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
                          <p className="text-[11px] text-gray-500 mt-1.5" role="status">
                            {t('breakingTeaser', { count: ev.total_votes ?? 0 })}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </motion.article>
              )
            })}
            </div>
          </div>
        )}
        {toast && (
          <p className="mt-4 text-sm text-king-gold" role="status">
            {toast}
          </p>
        )}
        <CommitmentModal
          open={Boolean(pending)}
          onClose={closeCommitmentModal}
          onConfirm={handleCommitmentConfirm}
          optionLabel={pending?.optionLabel ?? ''}
          loading={Boolean(submitting)}
        />
      </div>
    </div>
  )
}
