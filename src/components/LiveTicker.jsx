/**
 * LiveTicker — 即時戰報跑馬燈
 * 使用 Firestore onSnapshot 監聽最近 10 筆投票，以 framer-motion 淡入與橫向滾動呈現。
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { TEAMS, STANCES } from '../lib/constants'

const TICKER_LIMIT = 10

function getTeamFanLabel(voterTeam) {
  const t = TEAMS.find((x) => x.value === voterTeam)
  return t ? `${t.label}球迷` : '某地球迷'
}

function getStanceDisplay(status) {
  const s = STANCES.find((x) => x.value === status)
  if (!s) return status
  if (s.value === 'villain') return '終極反派'
  if (s.value === 'goat') return 'GOAT'
  return s.label
}

function formatTimeAgo(createdAt) {
  if (!createdAt?.toMillis) return '剛剛'
  const sec = Math.floor((Date.now() - createdAt.toMillis()) / 1000)
  if (sec < 60) return `${sec}秒前`
  if (sec < 3600) return `${Math.floor(sec / 60)}分鐘前`
  return '稍早'
}

export default function LiveTicker() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const q = query(
      collection(db, 'votes'),
      orderBy('createdAt', 'desc'),
      limit(TICKER_LIMIT)
    )
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setItems(list)
      },
      (err) => console.warn('[LiveTicker] onSnapshot error', err)
    )
    return () => unsubscribe()
  }, [])

  if (items.length === 0) return null

  return (
    <div className="border-b border-villain-purple/30 bg-gray-950/90 overflow-hidden py-2" role="region" aria-label="即時戰報">
      <div className="flex items-center gap-2 text-king-gold text-sm font-semibold px-4 mb-1">
        <span aria-hidden>🔥</span>
        <span>即時戰報</span>
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
              {formatTimeAgo(vote.createdAt)}，一位來自
              <strong className="text-king-gold mx-1">{vote.city || vote.country || '未知'}</strong>
              的
              <strong className="text-villain-purple/90 mx-1">{getTeamFanLabel(vote.voterTeam)}</strong>
              投下了
              <strong className="text-king-gold mx-1">{getStanceDisplay(vote.status)}</strong>！
            </motion.span>
          ))}
        </motion.div>
      </div>
    </div>
  )
}
