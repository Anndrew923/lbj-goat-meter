/**
 * StanceRadarChart — 戰區立場雷達圖（精簡版，供 BattleCard 使用）
 * 依 warzoneStats 繪製六邊形佔比，使用 STANCE_COLORS 與 getStancesForArena。
 */
import { useMemo } from 'react'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { getStancesForArena } from '../i18n/i18n'
import { STANCE_COLORS } from '../lib/constants'
import { hexWithAlpha } from '../utils/colorUtils'

/** 從 warzoneStats 建雷達資料 */
function buildRadarData(warzoneStats) {
  const rows = getStancesForArena()
  const total = typeof warzoneStats?.totalVotes === 'number' && warzoneStats.totalVotes > 0
    ? warzoneStats.totalVotes
    : 0
  return rows.map((s) => ({
    stanceKey: s.value,
    title: s.primary,
    value: total > 0 && typeof warzoneStats[s.value] === 'number'
      ? Math.round((warzoneStats[s.value] / total) * 100)
      : 0,
    fullMark: 100,
  }))
}

export default function StanceRadarChart({ warzoneStats, userStance, height = 200 }) {
  const radarData = useMemo(() => buildRadarData(warzoneStats), [warzoneStats])
  const strokeColor = useMemo(() => {
    if (userStance && radarData.length > 0) {
      const d = radarData.find((r) => r.stanceKey === userStance)
      if (d) return STANCE_COLORS[userStance] ?? STANCE_COLORS.goat
    }
    if (radarData.length === 0) return STANCE_COLORS.goat
    const top = radarData.reduce((a, b) => (a.value >= b.value ? a : b), radarData[0])
    return STANCE_COLORS[top.stanceKey] ?? STANCE_COLORS.goat
  }, [radarData, userStance])

  return (
    <div
      className="w-full min-w-0"
      style={{
        height,
        filter: `drop-shadow(0 0 12px ${hexWithAlpha(strokeColor, '80')})`,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={radarData}
          margin={{ top: 24, right: 32, bottom: 24, left: 32 }}
          outerRadius="75%"
          startAngle={90}
          isAnimationActive
          animationDuration={400}
        >
          <PolarGrid stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />
          <PolarAngleAxis
            dataKey="title"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 9 }}
            tickLine={false}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 8 }}
          />
          <Radar
            name="%"
            dataKey="value"
            stroke={strokeColor}
            fill={strokeColor}
            fillOpacity={0.4}
            strokeWidth={3}
            isAnimationActive
            animationDuration={400}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
