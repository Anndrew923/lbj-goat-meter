/**
 * LiveTicker — 即時戰報跑馬燈
 * 數據來自 WarzoneDataContext（global_summary.recentVotes），嚴禁掃描 votes 集合。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useWarzoneData } from '../context/WarzoneDataContext'
import { getTeamCityKey } from '../lib/constants'
import { getStanceDisplayTicker } from '../i18n/i18n'

function getTeamFanLabel(voterTeam, t) {
  if (!voterTeam) return t('someFan')
  const label = t(getTeamCityKey(voterTeam))
  return `${label}${t('fanSuffix')}`
}

function getStanceDisplay(status) {
  const label = getStanceDisplayTicker(status)
  if (label != null && label !== '') return label
  return status != null ? String(status) : '—'
}

function formatTimeAgo(createdAt, t) {
  if (!createdAt?.toMillis) return t('justNow')
  const sec = Math.floor((Date.now() - createdAt.toMillis()) / 1000)
  if (sec < 60) return t('secondsAgo', { count: sec })
  if (sec < 3600) return t('minutesAgo', { count: Math.floor(sec / 60) })
  return t('earlier')
}

export default function LiveTicker() {
  const { t } = useTranslation('common')
  const { recentVotes } = useWarzoneData()
  const items = useMemo(
    () => (recentVotes ?? []).map((v, i) => ({ id: `recent-${i}`, ...v })),
    [recentVotes]
  )

  if (items.length === 0) return null

  return (
    <div className="border-b border-villain-purple/30 bg-gray-950/90 overflow-hidden py-2" role="region" aria-label={t('liveTicker')}>
      <div className="flex items-center gap-2 text-king-gold text-sm font-semibold px-4 mb-1">
        <span aria-hidden>🔥</span>
        <span>{t('liveTicker')}</span>
      </div>
      <div className="overflow-x-auto overflow-y-hidden">
        <motion.div className="flex gap-6 px-4 py-1 min-w-max" style={{ width: 'max-content' }}>
          {items.map((vote, index) => (
            <motion.span
              key={vote.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="inline-flex items-center gap-2 text-sm text-gray-300 whitespace-nowrap"
            >
              {formatTimeAgo(vote.createdAt, t)}{t('tickerFrom')}
              <strong className="text-king-gold mx-1">{vote.city || vote.country || t('unknown')}</strong>
              {t('tickerOf')}
              <strong className="text-villain-purple/90 mx-1">{getTeamFanLabel(vote.voterTeam, t)}</strong>
              {t('tickerVoted')}
              <strong className="text-king-gold mx-1">{getStanceDisplay(vote.status)}</strong>{t('tickerExclamation')}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </div>
  )
}
