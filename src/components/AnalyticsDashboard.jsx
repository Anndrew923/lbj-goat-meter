/**
 * AnalyticsDashboard — 高階數據視覺化（置於 AnalystGate 內）
 * 立場雷達圖 + 原因熱點（所選群體 like/dislike Top 3 原因）。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
import { getStancesForArena, getReasonLabelMap } from '../i18n/i18n'
import { STANCE_COLORS } from '../lib/constants'

const LIKE_STANCES = new Set(['goat', 'king', 'machine'])
const DISLIKE_STANCES = new Set(['fraud', 'stat_padder', 'mercenary'])
const LABEL_OFFSET_PX = 20

export default function AnalyticsDashboard({ filters = {} }) {
  const { t, i18n } = useTranslation('common')
  const stableFilters = useMemo(() => ({ ...filters }), [filters])
  const { data, loading, error } = useSentimentData(stableFilters, { pageSize: 500 })
  // 語系切換時需重算（getReasonLabelMap 透過 getReasonsResource 讀取當前語系）
  // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language 用於語系切換時使 map 失效
  const reasonLabelMap = useMemo(() => getReasonLabelMap(), [i18n.language])

  const radarData = useMemo(() => {
    const rows = getStancesForArena()
    const total = data.length
    if (total === 0) {
      return rows.map((s) => ({
        stanceKey: s.value,
        title: s.primary,
        stance: s.secondary,
        value: 0,
        fullMark: 100,
      }))
    }
    const byStatus = {}
    data.forEach((v) => {
      const s = v.status ?? 'unknown'
      byStatus[s] = (byStatus[s] ?? 0) + 1
    })
    return rows.map((s) => ({
      stanceKey: s.value,
      title: s.primary,
      stance: s.secondary,
      value: total > 0 ? Math.round(((byStatus[s.value] ?? 0) / total) * 100) : 0,
      fullMark: 100,
    }))
  }, [data])

  /** 最高票立場的色碼，供 Radar stroke 聯動 */
  const topStanceStroke = useMemo(() => {
    if (!radarData.length) return STANCE_COLORS.goat
    const top = radarData.reduce((a, b) => (a.value >= b.value ? a : b), radarData[0])
    return STANCE_COLORS[top.stanceKey] ?? STANCE_COLORS.goat
  }, [radarData])

  /** 藥丸標籤：rect(rx=12) + 依角度推離 20px，邊框/文字聯動 STANCE_COLORS */
  const renderPolarAngleTick = ({ payload, index, x, y }) => {
    const count = radarData.length
    const dataPoint = radarData[index]
    const angleDeg = count > 0 ? 90 + (360 / count) * index : 90
    const rad = (angleDeg * Math.PI) / 180
    const dx = LABEL_OFFSET_PX * Math.cos(rad)
    const dy = LABEL_OFFSET_PX * Math.sin(rad)
    const tx = x + dx
    const ty = y + dy
    const isLeft = angleDeg > 90 && angleDeg < 270
    const textAnchor = isLeft ? 'end' : 'start'
    const label = dataPoint?.title ?? payload?.title ?? payload?.value ?? ''
    const stanceKey = dataPoint?.stanceKey ?? payload?.stanceKey ?? 'goat'
    const strokeColor = STANCE_COLORS[stanceKey] ?? '#D4AF37'
    const pillWidth = Math.max(56, (label.length || 1) * 6 + 20)
    const pillHeight = 22
    return (
      <g transform={`translate(${tx},${ty})`}>
        <rect
          x={textAnchor === 'end' ? -pillWidth : 0}
          y={-pillHeight / 2}
          width={pillWidth}
          height={pillHeight}
          rx={12}
          fill="rgba(255,255,255,0.05)"
          stroke={strokeColor}
          strokeWidth={1}
        />
        <text
          textAnchor={textAnchor}
          fill={strokeColor}
          fontSize={11}
          dominantBaseline="middle"
          x={textAnchor === 'end' ? -8 : 8}
          y={0}
        >
          {label}
        </text>
      </g>
    )
  }

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
        .map(([value]) => ({ value, label: reasonLabelMap[value] || value }))
    return {
      like: top(likeCounts, 3),
      dislike: top(dislikeCounts, 3),
    }
  }, [data, reasonLabelMap])

  if (loading) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">{t('loadingDashboard')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-red-400" role="alert">{t('loadErrorShort')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6 space-y-6">
      <h3 className="text-lg font-bold text-king-gold">{t('radarTitle')}</h3>
      <div className="h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={radarData}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            outerRadius="90%"
            startAngle={90}
            isAnimationActive
            animationDuration={400}
            animationEasing="ease-out"
          >
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis
              dataKey="title"
              tick={renderPolarAngleTick}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <Radar
              name={t('radarShareName')}
              dataKey="value"
              stroke={topStanceStroke}
              fill={topStanceStroke}
              fillOpacity={0.35}
              strokeWidth={4}
              isAnimationActive
              animationDuration={400}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid rgba(75,0,130,0.5)', borderRadius: 8 }}
              labelStyle={{ color: '#D4AF37' }}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.stance ?? label}
              formatter={(value) => [`${value}%`, t('radarShareLabel')]}
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
          <h4 className="text-sm font-semibold text-king-gold mb-2">{t('topReasonsLike')}</h4>
          <ul className="space-y-1 text-sm text-gray-300">
            {topReasons.like.length ? topReasons.like.map((r, i) => (
              <li key={r.value}>{i + 1}. {r.label}</li>
            )) : <li className="text-gray-500">{t('noData')}</li>}
          </ul>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-villain-purple/30 bg-black/50 p-4"
        >
          <h4 className="text-sm font-semibold text-villain-purple mb-2">{t('topReasonsDislike')}</h4>
          <ul className="space-y-1 text-sm text-gray-300">
            {topReasons.dislike.length ? topReasons.dislike.map((r, i) => (
              <li key={r.value}>{i + 1}. {r.label}</li>
            )) : <li className="text-gray-500">{t('noData')}</li>}
          </ul>
        </motion.div>
      </div>
    </div>
  )
}
