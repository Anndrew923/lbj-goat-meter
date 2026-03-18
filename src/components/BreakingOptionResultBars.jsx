/**
 * BreakingOptionResultBars — 突發戰區投票結果條（Vote-to-Reveal 已投狀態）
 *
 * 設計意圖：
 * - 供 UniversalBreakingBanner 與 BreakingHistoryPage 共用，避免重複邏輯。
 * - 依 vote_counts / total_votes 計算百分比，以水平進度條 + 選項文字呈現。
 * - 使用 framer-motion layout 與 animate 提供一致過場。
 */
import { motion } from 'framer-motion'

/**
 * @param {{ options: Array<{ label: string }>, voteCounts: Record<string, number>, totalVotes: number, optimisticOptionIndex?: number }} props
 *   optimisticOptionIndex: 剛投完票尚未收到 Firestore 更新時，用於樂觀顯示該選項 +1 票與總數 +1
 */
export default function BreakingOptionResultBars({
  options,
  voteCounts = {},
  totalVotes = 0,
  optimisticOptionIndex,
}) {
  if (!options?.length) return null

  const hasServerData = totalVotes > 0
  const effectiveTotal = hasServerData ? totalVotes : optimisticOptionIndex !== undefined ? 1 : 0

  return (
    <motion.div
      layout
      className="space-y-2"
      initial={false}
      transition={{ layout: { duration: 0.25 } }}
      role="list"
      aria-label="投票結果"
    >
      {options.map((opt, i) => {
        const label = typeof opt === 'object' && opt !== null ? opt.label : String(opt ?? '')
        if (!label) return null
        const serverCount = Number(voteCounts[String(i)] ?? voteCounts[i] ?? 0)
        const optimisticBonus =
          !hasServerData && i === optimisticOptionIndex ? 1 : 0
        const count = serverCount + optimisticBonus
        const percent = effectiveTotal > 0 ? (count / effectiveTotal) * 100 : 0
        return (
          <motion.div
            key={i}
            layout
            className="rounded-md overflow-hidden bg-gray-800/80"
            transition={{ layout: { duration: 0.25 } }}
            role="listitem"
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span className="text-king-gold font-medium truncate">{label}</span>
              <span className="text-gray-400 shrink-0">{percent.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-gray-900/80 overflow-hidden" aria-hidden>
              <motion.div
                layout
                className="h-full bg-king-gold rounded-r"
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{ minWidth: percent > 0 ? 4 : 0 }}
              />
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}
