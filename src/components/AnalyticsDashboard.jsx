/**
 * AnalyticsDashboard — 高階數據視覺化（置於 AnalystGate 內）
 * 立場雷達圖 + 原因熱點（所選群體 like/dislike Top 3 原因）。
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { useSentimentData } from '../hooks/useSentimentData'
import { STANCES, REASONS_BY_STANCE } from '../lib/constants'

const LIKE_STANCES = new Set(['goat', 'king'])
const DISLIKE_STANCES = new Set(['villain', 'decider'])

function buildReasonLabelMap() {
  const m = {}
  Object.values(REASONS_BY_STANCE).forEach((arr) => {
    arr.forEach(({ value, label }) => { m[value] = label })
  })
  return m
}

const REASON_LABELS = buildReasonLabelMap()

export default function AnalyticsDashboard({ filters = {} }) {
  const stableFilters = useMemo(() => ({ ...filters }), [filters])
  const { data, loading, error } = useSentimentData(stableFilters, { pageSize: 500 })

  const radarData = useMemo(() => {
    const total = data.length
    if (total === 0) return STANCES.map((s) => ({ stance: s.label, value: 0, fullMark: 100 }))
    const byStatus = {}
    data.forEach((v) => {
      const s = v.status ?? 'unknown'
      byStatus[s] = (byStatus[s] ?? 0) + 1
    })
    return STANCES.map((s) => ({
      stance: s.label,
      value: total > 0 ? Math.round(((byStatus[s.value] ?? 0) / total) * 100) : 0,
      fullMark: 100,
    }))
  }, [data])

  const topReasons = useMemo(() => {
    const likeCounts = {}
    const dislikeCounts = {}
    data.forEach((v) => {
      const reasons = Array.isArray(v.reasons) ? v.reasons : []
      if (LIKE_STANCES.has(v.status)) {
        reasons.forEach((r) => { likeCounts[r] = (likeCounts[r] ?? 0) + 1 })
      } else if (DISLIKE_STANCES.has(v.status)) {
        reasons.forEach((r) => { dislikeCounts[r] = (dislikeCounts[r] ?? 0) + 1 })
      }
    })
    const top = (obj, n) =>
      Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([value]) => ({ value, label: REASON_LABELS[value] || value }))
    return {
      like: top(likeCounts, 3),
      dislike: top(dislikeCounts, 3),
    }
  }, [data])

  if (loading) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">載入儀表板…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-red-400" role="alert">無法載入數據。</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6 space-y-6">
      <h3 className="text-lg font-bold text-king-gold">立場雷達</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
            <PolarGrid stroke="rgba(75,0,130,0.3)" />
            <PolarAngleAxis
              dataKey="stance"
              tick={{ fill: '#D4AF37', fontSize: 11 }}
              tickLine={{ stroke: 'rgba(212,175,55,0.3)' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
            />
            <Radar
              name="占比 %"
              dataKey="value"
              stroke="#D4AF37"
              fill="#D4AF37"
              fillOpacity={0.4}
              strokeWidth={2}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid rgba(75,0,130,0.5)', borderRadius: 8 }}
              labelStyle={{ color: '#D4AF37' }}
              formatter={(value) => [`${value}%`, '占比']}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-king-gold/30 bg-black/50 p-4"
        >
          <h4 className="text-sm font-semibold text-king-gold mb-2">支持方 Top 3 原因</h4>
          <ul className="space-y-1 text-sm text-gray-300">
            {topReasons.like.length ? topReasons.like.map((r, i) => (
              <li key={r.value}>{i + 1}. {r.label}</li>
            )) : <li className="text-gray-500">尚無數據</li>}
          </ul>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-villain-purple/30 bg-black/50 p-4"
        >
          <h4 className="text-sm font-semibold text-villain-purple mb-2">反對方 Top 3 原因</h4>
          <ul className="space-y-1 text-sm text-gray-300">
            {topReasons.dislike.length ? topReasons.dislike.map((r, i) => (
              <li key={r.value}>{i + 1}. {r.label}</li>
            )) : <li className="text-gray-500">尚無數據</li>}
          </ul>
        </motion.div>
      </div>
    </div>
  )
}
