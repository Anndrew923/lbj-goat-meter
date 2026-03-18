/**
 * useGlobalBreakingEvents — 突發戰區通用引擎：訂閱 global_events 集合
 *
 * 設計意圖：
 * - 跨專案單一集合 global_events，以 target_app 陣列篩選所屬 App，僅回傳 is_active 的活動。
 * - 供 UniversalBreakingBanner 消費，投票前／投票後皆可顯示突發話題入口。
 * - 卸載時取消 onSnapshot，避免殘留監聽與多餘 Reads。
 *
 * Firestore 複合索引：若同時 where('target_app','array-contains',id) 與 where('is_active','==',true)，
 * 需在 Console 建立對應複合索引（或依錯誤連結自動建立）。
 */

import { useState, useEffect } from 'react'
import {
  collection,
  query,
  where,
  limit,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseReady } from '../lib/firebase'
import { PROJECT_APP_ID, GLOBAL_EVENTS_COLLECTION } from '../lib/constants'
import { loadLastVotedSafe } from '../utils/breakingVoteStorage'

const MAX_EVENTS = 5
const MAX_EVENTS_HISTORY = 50

/**
 * @param {string} [appId] - 當前專案 App ID，預設 PROJECT_APP_ID（goat_meter）
 * @param {{ includeInactive?: boolean, limit?: number }} [opts] - includeInactive: 含未啟用話題（歷史頁）；limit: 筆數上限
 * @returns {{ events: Array<{ id: string, title: Record<string, string>|string, description?: Record<string, string>|string, image_url?: string, options?: Array<Record<string, string>|string>, target_app?: string[], is_active?: boolean }>, loading: boolean, error: Error | null }}
 */
export function useGlobalBreakingEvents(appId = PROJECT_APP_ID, opts = {}) {
  const { includeInactive = false, limit: limitOverride } = opts
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isFirebaseReady || !appId?.trim()) {
      setLoading(false)
      setEvents([])
      return undefined
    }

    const col = collection(db, GLOBAL_EVENTS_COLLECTION)
    const constraints = [
      where('target_app', 'array-contains', appId.trim()),
      orderBy('createdAt', 'desc'),
      limit(includeInactive ? (limitOverride ?? MAX_EVENTS_HISTORY) : (limitOverride ?? MAX_EVENTS)),
    ]
    if (!includeInactive) {
      constraints.splice(1, 0, where('is_active', '==', true))
    }
    const q = query(col, ...constraints)

    let unsubscribe
    try {
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          let list = (snapshot.docs ?? [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))

          const lastVoted = loadLastVotedSafe()

          if (import.meta.env.DEV) {
            const target = lastVoted ? list.find((e) => e.id === lastVoted.eventId) : null
            console.log('[useGlobalBreakingEvents] snapshot', {
              listLength: list.length,
              lastVotedEventId: lastVoted?.eventId ?? null,
              targetTotalVotes: target != null ? (target.total_votes ?? 0) : 'N/A',
              targetVoteCounts: target?.vote_counts ?? null,
            })
          }

          // 返回首頁時首筆快照常為空（快取尚未就緒），若此時寫入 events=[] 會導致 return null、banner 消失。
          // 有 lastVoted 表示用戶剛投過票，略過空快照不更新，等有資料再寫入，避免「結果丟失」。
          if (list.length === 0 && lastVoted) {
            if (import.meta.env.DEV) console.log('[useGlobalBreakingEvents] 略過空快照，等待有資料')
            setError(null)
            return
          }

          // 當本地紀錄「剛對某話題投過票」且該話題在 Firestore 仍為 total_votes === 0 時，
          // 不論快照來自快取或伺服器，都做一次暫時性補正（total_votes = 1、對應選項 +1），
          // 避免「從戰區返回首頁」或重新整理時，首筆快照尚未含寫入結果而顯示 0 票。
          if (lastVoted) {
            list = list.map((ev) => {
              if (ev.id !== lastVoted.eventId) return ev
              const currentTotal = typeof ev.total_votes === 'number' ? ev.total_votes : 0
              if (currentTotal > 0) return ev
              if (import.meta.env.DEV) console.log('[useGlobalBreakingEvents] 補正樂觀票數', { eventId: ev.id, optionIndex: lastVoted.optionIndex })
              const voteCounts = typeof ev.vote_counts === 'object' && ev.vote_counts !== null ? { ...ev.vote_counts } : {}
              const key = String(lastVoted.optionIndex)
              const existing = typeof voteCounts[key] === 'number' ? voteCounts[key] : 0
              return {
                ...ev,
                total_votes: 1,
                vote_counts: {
                  ...voteCounts,
                  [key]: existing > 0 ? existing : 1,
                },
              }
            })
          }

          setEvents(list)
          setError(null)
          setLoading(false)
        },
        (err) => {
          if (import.meta.env.DEV) {
            console.warn('[useGlobalBreakingEvents]', err?.message ?? err)
          }
          setError(err)
          setEvents([])
          setLoading(false)
        }
      )
    } catch (err) {
      setError(err)
      setEvents([])
      setLoading(false)
    }

    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [appId, includeInactive, limitOverride])

  return { events, loading, error }
}
