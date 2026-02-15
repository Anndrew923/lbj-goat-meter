/**
 * LiveTicker — 即時戰報跑馬燈
 * 使用 Firestore onSnapshot 監聽最近 10 筆投票，以 framer-motion 淡入與橫向滾動呈現。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseReady } from '../lib/firebase'
import { TEAMS } from '../lib/constants'
import { getStanceDisplayTicker } from '../i18n/i18n'

const TICKER_LIMIT = 10

function getTeamFanLabel(voterTeam, t) {
  const team = TEAMS.find((x) => x.value === voterTeam)
  if (!team) return t('someFan')
  const label = t(`team_${team.value}`)
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
  const [items, setItems] = useState([])
  const unsubRef = useRef(null)

  // 僅在 db 就緒後延遲啟動監聽，避免連線未穩定時 onSnapshot 導致 Listen Stream 報錯、戰區卡死
  useEffect(() => {
    if (!isFirebaseReady || !db) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      const q = query(
        collection(db, 'votes'),
        orderBy('createdAt', 'desc'),
        limit(TICKER_LIMIT)
      )
      unsubRef.current = onSnapshot(
        q,
        (snap) => {
          if (!cancelled) {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            setItems(list)
          }
        },
        (err) => console.warn('[LiveTicker] onSnapshot error', err)
      )
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [])

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
