/**
 * SentimentStats — 情緒數據看板
 * 使用 useSentimentData 取得全球投票，以進度條顯示各立場分佈。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useSentimentData } from '../hooks/useSentimentData'
import { STANCES } from '../lib/constants'

const EMPTY_FILTERS = {}

export default function SentimentStats({ filters = EMPTY_FILTERS }) {
  const stableFilters = useMemo(() => (filters && Object.keys(filters).length ? { ...filters } : EMPTY_FILTERS), [filters])
  const { data, loading, error } = useSentimentData(stableFilters, { pageSize: 500 })

  const stats = useMemo(() => {
    const total = data.length
    if (total === 0) return { total: 0, byStatus: {}, otherCount: 0 }
    const byStatus = {}
    data.forEach((v) => {
      const s = v.status ?? 'unknown'
      byStatus[s] = (byStatus[s] ?? 0) + 1
    })
    const knownValues = new Set(STANCES.map((s) => s.value))
    const otherCount = Object.entries(byStatus).reduce(
      (sum, [status, count]) => (knownValues.has(status) ? sum : sum + count),
      0
    )
    return { total, byStatus, otherCount }
  }, [data])

  if (loading) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-king-gold animate-pulse" role="status">載入全球數據…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-red-400" role="alert">無法載入數據，請稍後再試。</p>
      </div>
    )
  }

  const { total, byStatus, otherCount } = stats
  const orderedStances = STANCES.map((s) => s.value)

  const renderBar = (statusKey, label, theme, count) => {
    const pct = total > 0 ? (count / total) * 100 : 0
    return (
      <motion.div
        key={statusKey}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-3"
      >
        <span className="w-20 text-sm text-gray-300 truncate">{label}</span>
        <div className="flex-1 h-6 rounded-full bg-gray-800 overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              theme === 'king-gold'
                ? 'bg-king-gold'
                : theme === 'villain-purple'
                  ? 'bg-villain-purple'
                  : 'bg-gray-500'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <span className="w-12 text-right text-sm text-gray-400">{count}</span>
      </motion.div>
    )
  }

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
      <h3 className="text-lg font-bold text-king-gold mb-2">全球投票分佈</h3>
      <p className="text-sm text-gray-400 mb-4">共 {total} 票</p>
      <div className="space-y-3">
        {orderedStances.map((status) => {
          const stance = STANCES.find((s) => s.value === status)
          const count = byStatus[status] ?? 0
          return renderBar(status, stance?.label ?? status, stance?.theme ?? 'gray', count)
        })}
        {otherCount > 0 &&
          renderBar('other', '其他', 'gray', otherCount)}
      </div>
    </div>
  )
}
