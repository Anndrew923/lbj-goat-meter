/**
 * BreakingOptionResultBars — 突發戰區投票結果條（Vote-to-Reveal 已投狀態）
 *
 * 設計意圖：
 * - 供 UniversalBreakingBanner 與 BreakingHistoryPage 共用，避免重複邏輯。
 * - 依 vote_counts / total_votes 計算百分比，以水平進度條 + 選項文字呈現。
 * - 使用 framer-motion layout 與 animate 提供一致過場。
 * - 外層依 isLoggedIn 分流：未登入者不掛載含 tooltip／計時器的重邏輯子元件（維持 hooks 規則且減少無謂工作）。
 */
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 未登入：只顯示總參與人數（不掛載進度條／tooltip 相關 state）
 */
function BreakingVoteAnonymousSummary({ totalVotes, optimisticOptionIndex }) {
  const { t } = useTranslation('common')
  const hasServerData = totalVotes > 0
  const displayTotal = hasServerData ? totalVotes : optimisticOptionIndex !== undefined ? 1 : 0
  return (
    <div className="rounded-md bg-gray-800/80 px-2 py-2 text-center" role="status">
      <p className="text-xs text-gray-400">
        {t('breakingAnonymousResultSummary', { count: displayTotal.toLocaleString() })}
      </p>
    </div>
  )
}

/**
 * @param {{ options: Array<{ label: string }>, voteCounts: Record<string, number>, totalVotes: number, optimisticOptionIndex?: number }} props
 */
function BreakingVoteResultBarsInner({
  options,
  voteCounts = {},
  totalVotes = 0,
  optimisticOptionIndex,
}) {
  const { t } = useTranslation('common')
  const hasServerData = totalVotes > 0
  const effectiveTotal = hasServerData ? totalVotes : optimisticOptionIndex !== undefined ? 1 : 0

  const [tooltipIndex, setTooltipIndex] = useState(null)
  const longPressTimerRef = useRef(null)
  const autoHideTimerRef = useRef(null)
  const didLongPressRef = useRef(false)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current)
      autoHideTimerRef.current = null
    }
  }, [])

  const scheduleAutoHide = useCallback(() => {
    clearAutoHideTimer()
    autoHideTimerRef.current = setTimeout(() => {
      setTooltipIndex(null)
    }, 5000)
  }, [clearAutoHideTimer])

  useEffect(() => {
    return () => {
      clearLongPressTimer()
      clearAutoHideTimer()
    }
  }, [clearAutoHideTimer, clearLongPressTimer])

  if (!options?.length) return null

  return (
    <motion.div
      layout
      className="space-y-2"
      initial={false}
      transition={{ layout: { duration: 0.25 } }}
      role="list"
      aria-label={t('breakingResultAria')}
    >
      {options.map((opt, i) => {
        const label = typeof opt === 'object' && opt !== null ? opt.label : String(opt ?? '')
        if (!label) return null
        const serverCount = Number(voteCounts[String(i)] ?? voteCounts[`'${i}'`] ?? voteCounts[i] ?? 0)
        const optimisticBonus =
          !hasServerData && i === optimisticOptionIndex ? 1 : 0
        const count = serverCount + optimisticBonus
        const percent = effectiveTotal > 0 ? (count / effectiveTotal) * 100 : 0
        return (
          <motion.div
            key={i}
            layout
            className="rounded-md bg-gray-800/80 relative pointer-events-auto cursor-pointer"
            transition={{ layout: { duration: 0.25 } }}
            role="listitem"
            tabIndex={0}
            aria-label={t('breakingVoteCountTooltip', { count: count.toLocaleString() })}
            title={t('breakingVoteCountTooltip', { count: count.toLocaleString() })}
            onMouseEnter={() => {
              clearAutoHideTimer()
              setTooltipIndex(i)
            }}
            onMouseLeave={() => {
              setTooltipIndex((prev) => (prev === i ? null : prev))
            }}
            onTouchStart={() => {
              didLongPressRef.current = false
              clearAutoHideTimer()
              clearLongPressTimer()
              longPressTimerRef.current = setTimeout(() => {
                didLongPressRef.current = true
                setTooltipIndex(i)
                scheduleAutoHide()
              }, 450)
            }}
            onTouchMove={() => {
              didLongPressRef.current = false
              clearLongPressTimer()
            }}
            onTouchEnd={() => {
              clearLongPressTimer()
            }}
            onTouchCancel={() => {
              clearLongPressTimer()
            }}
            onClick={() => {
              if (didLongPressRef.current) {
                didLongPressRef.current = false
                return
              }
              clearLongPressTimer()
              setTooltipIndex((prev) => {
                const next = prev === i ? null : i
                return next
              })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              clearLongPressTimer()
              clearAutoHideTimer()
              setTooltipIndex((prev) => {
                const next = prev === i ? null : i
                return next
              })
            }}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span className="text-king-gold font-medium truncate">{label}</span>
              <span className="text-gray-400 shrink-0">
                {t('breakingPercentLabel', { percent: percent.toFixed(0) })}
              </span>
            </div>

            <div className="h-1.5 bg-gray-900/80 overflow-hidden select-none">
              <motion.div
                layout
                className="h-full bg-king-gold rounded-r"
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{ minWidth: percent > 0 ? 4 : 0 }}
                aria-hidden
              />
            </div>

            {tooltipIndex === i && (
              <div className="px-2 pb-2 pt-1">
                <div className="inline-flex items-center whitespace-nowrap rounded border border-yellow-500 bg-black/60 px-2 py-0.5 text-[11px] text-white shadow-sm">
                  {t('breakingVoteCountTooltip', { count: count.toLocaleString() })}
                </div>
              </div>
            )}
          </motion.div>
        )
      })}
    </motion.div>
  )
}

/**
 * @param {{ options: Array<{ label: string }>, voteCounts: Record<string, number>, totalVotes: number, optimisticOptionIndex?: number, isLoggedIn?: boolean }} props
 *   optimisticOptionIndex: 剛投完票尚未收到 Firestore 更新時，用於樂觀顯示該選項 +1 票與總數 +1
 *   isLoggedIn: 未登入時僅顯示總參與人數（不揭露各選項票數／百分比）
 */
export default function BreakingOptionResultBars({
  options,
  voteCounts = {},
  totalVotes = 0,
  optimisticOptionIndex,
  isLoggedIn = true,
}) {
  if (!isLoggedIn) {
    return (
      <BreakingVoteAnonymousSummary
        totalVotes={totalVotes}
        optimisticOptionIndex={optimisticOptionIndex}
      />
    )
  }
  return (
    <BreakingVoteResultBarsInner
      options={options}
      voteCounts={voteCounts}
      totalVotes={totalVotes}
      optimisticOptionIndex={optimisticOptionIndex}
    />
  )
}
