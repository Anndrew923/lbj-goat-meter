/**
 * BreakingVoteContext — 突發戰區投票狀態跨路由保持
 *
 * 設計意圖：votedEventIds / lastVoted 放在 Context，路由從 /vote ↔ /breaking-history 切換時
 * Provider 不卸載，狀態不丟失；同時寫入 localStorage 供重新整理後還原。
 */
import { createContext, useContext, useCallback, useState, useEffect } from 'react'
import {
  loadVotedEventIds,
  saveVotedEventIds,
  loadLastVoted,
  saveLastVoted,
  clearLastVoted as clearLastVotedStorage,
} from '../utils/breakingVoteStorage'

const BreakingVoteContext = createContext(null)

export function BreakingVoteProvider({ children }) {
  const [votedEventIds, setVotedEventIds] = useState(() => loadVotedEventIds())
  const [lastVoted, setLastVoted] = useState(() => loadLastVoted())

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
  }, [])

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

  const value = {
    votedEventIds,
    lastVoted,
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
