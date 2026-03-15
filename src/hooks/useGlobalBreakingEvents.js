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
  onSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseReady } from '../lib/firebase'
import { PROJECT_APP_ID, GLOBAL_EVENTS_COLLECTION } from '../lib/constants'

const MAX_EVENTS = 5

/**
 * @param {string} [appId] - 當前專案 App ID，預設 PROJECT_APP_ID（goat_meter）
 * @returns {{ events: Array<{ id: string, title: Record<string, string>|string, description?: Record<string, string>|string, image_url?: string, options?: Array<Record<string, string>|string>, target_app?: string[], is_active?: boolean }>, loading: boolean, error: Error | null }}
 */
export function useGlobalBreakingEvents(appId = PROJECT_APP_ID) {
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
    const q = query(
      col,
      where('target_app', 'array-contains', appId.trim()),
      where('is_active', '==', true),
      limit(MAX_EVENTS)
    )

    let unsubscribe
    try {
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list = (snapshot.docs ?? [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
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
  }, [appId])

  return { events, loading, error }
}
