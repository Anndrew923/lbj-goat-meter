/**
 * BreakingVoteContext — 突發戰區投票狀態跨路由保持
 *
 * 設計意圖：votedEventIds / lastVoted 放在 Context，路由從 /vote ↔ /breaking-history 切換時
 * Provider 不卸載，狀態不丟失。
 * votedEventIds 以 Firestore `profiles/{uid}/breaking_votes` 為準；localStorage 僅作斷線時快取。
 */
import { createContext, useContext, useCallback, useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseReady } from '../lib/firebase'
import { useAuth } from './AuthContext'
import {
  loadVotedEventIds,
  saveVotedEventIds,
  loadLastVoted,
  saveLastVoted,
  clearLastVoted as clearLastVotedStorage,
  loadLastFreeDate,
  saveLastFreeDate,
} from '../utils/breakingVoteStorage'

const BreakingVoteContext = createContext(null)

/** 比對兩組 eventId 是否相同（順序無關），避免 onSnapshot 重複觸發時無謂 render */
function sameVotedEventIds(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((id) => setA.has(id))
}

export function BreakingVoteProvider({ children }) {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid ?? null

  const [votedEventIds, setVotedEventIds] = useState(() => loadVotedEventIds())
  const [lastVoted, setLastVoted] = useState(() => loadLastVoted())
  const [lastFreeDate, setLastFreeDate] = useState(() => loadLastFreeDate())

  const today = new Date().toISOString().slice(0, 10)
  // 設計意圖：以純日期字串判斷是否已使用過本日首票免費資格
  const isFirstVoteOfDay = !lastFreeDate || lastFreeDate !== today

  const markEventVoted = useCallback((eventId, optionIndex) => {
    const payload = { eventId, optionIndex, timestamp: Date.now() }
    if (import.meta.env.DEV) {
      console.log('[BreakingVote] markEventVoted', { eventId, optionIndex })
    }
    setVotedEventIds((prev) => {
      const next = prev.includes(eventId) ? prev : [...prev, eventId]
      saveVotedEventIds(next)
      return next
    })
    setLastVoted(payload)
    saveLastVoted(payload)
    if (!lastFreeDate || lastFreeDate !== today) {
      setLastFreeDate(today)
      saveLastFreeDate(today)
    }
  }, [lastFreeDate, today])

  const clearLastVoted = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[BreakingVote] clearLastVoted (伺服器已回傳 total_votes > 0)')
    }
    setLastVoted(null)
    clearLastVotedStorage()
  }, [])

  useEffect(() => {
    const persisted = loadLastVoted()
    if (!persisted?.eventId) return
    setVotedEventIds((prev) => {
      if (prev.includes(persisted.eventId)) return prev
      const next = [...prev, persisted.eventId]
      saveVotedEventIds(next)
      return next
    })
  }, [])

  // 已登入：以 profiles/{uid}/breaking_votes 文件 id 為已投票清單（與 Cloud Function 存證一致）
  useEffect(() => {
    if (!uid || !isFirebaseReady || !db) {
      setVotedEventIds(loadVotedEventIds())
      return undefined
    }
    const colRef = collection(db, 'profiles', uid, 'breaking_votes')
    const unsub = onSnapshot(
      colRef,
      (snapshot) => {
        const ids = (snapshot.docs ?? []).map((d) => d.id).filter(Boolean)
        setVotedEventIds((prev) => {
          if (sameVotedEventIds(prev, ids)) return prev
          saveVotedEventIds(ids)
          return ids
        })
      },
      (err) => {
        if (import.meta.env.DEV) {
          console.warn('[BreakingVote] breaking_votes 訂閱失敗，改讀 localStorage 快取', err?.message)
        }
        setVotedEventIds(loadVotedEventIds())
      }
    )
    return () => unsub()
  }, [uid])

  const value = {
    votedEventIds,
    lastVoted,
    lastFreeDate,
    isFirstVoteOfDay,
    markEventVoted,
    clearLastVoted,
  }

  return (
    <BreakingVoteContext.Provider value={value}>
      {children}
    </BreakingVoteContext.Provider>
  )
}

export function useBreakingVote() {
  const ctx = useContext(BreakingVoteContext)
  if (!ctx) {
    throw new Error('useBreakingVote must be used within BreakingVoteProvider')
  }
  return ctx
}
