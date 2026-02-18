/**
 * useSentimentData — 情緒投票數據的實時漏斗 Hook（onSnapshot）
 *
 * 設計意圖：
 * - 以 onSnapshot 實時監聽 votes 集合，任一筆投票變動（本地或全球）即推送到 UI，圖表與百分比即時跳動，無需手動重新整理。
 * - 「全球總量」：當 filters 為空時，本 Hook 即為全球無篩選查詢，透過 Firestore onSnapshot 取得，用戶可見票數即時跳動。
 * - 支援「全球 → 國家 → 城市」與「年齡 / 性別 / 球隊」的多維度交叉查詢。
 * - 大盤百分比精準度（加總 100%）由消費端（如 SentimentStats）依本 data 做整數分配校準。
 *
 * Reads 優化注意：
 * - 本 Hook 訂閱的是「Collection 查詢」而非單一 Document，每次掛載 = 一組 Listener，會計入 Reads。
 * - 多個組件（如 SentimentStats + AnalyticsDashboard + PulseMap）各自呼叫會產生多組訂閱；若 filters 相同可考慮上層共用一筆 data 再分發。
 * - 卸載時必定執行 return () => unsubscribe()，避免殘留監聽器。
 *
 * 為何需要複合索引 (Composite Indexes)？
 * - Firestore 對「多欄位查詢」有硬性規定：只要在單一查詢中對「多個不同欄位」使用
 *   where()（或 where() 搭配 orderBy()），就必須事先在 Firebase Console 建立對應的
 *   複合索引，否則執行時會拋出錯誤並回傳建立索引的連結。
 *
 * 聯動延遲：通常 < 1 秒（依 Firestore 推送與網路狀況）。
 */

import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseReady } from '../lib/firebase'
import { STANCE_KEYS, PRO_STANCES, ANTI_STANCES } from '../lib/constants'

/** Firestore 訂閱逾時（毫秒），逾時後解除 loading 避免卡在「載入地圖…」 */
const SNAPSHOT_TIMEOUT_MS = 12_000

/** 預設球星 ID，與 SCHEMA 中 starId 對應 */
const DEFAULT_STAR_ID = 'lbj'

/** 單次查詢上限，避免一次拉取過多文件 */
const DEFAULT_PAGE_SIZE = 200

/** 是否含有有效篩選條件（任一欄位非空），供消費端決定用靜態或動態數據 */
export function hasActiveFilters(filters) {
  if (!filters || typeof filters !== 'object') return false
  return Object.values(filters).some((v) => v != null && String(v).trim() !== '')
}

/** 穩定空篩選參考，避免傳入字面量 {} 導致 useEffect 依賴每輪都變、觸發 Maximum update depth */
export const EMPTY_FILTERS = Object.freeze({})

/**
 * @typedef {Object} SentimentFilters
 * @property {string} [team] - voterTeam，例 "LAL", "GSW"
 * @property {string} [ageGroup] - "18-24" | "25-34" | "35-44" | "45+"
 * @property {string} [gender] - "m" | "f" | "o"
 * @property {string} [country] - ISO 國家代碼
 * @property {string} [city] - 城市名稱
 */

/**
 * 依篩選條件實時監聽 votes 集合的情緒數據（漏斗過濾）；資料庫變動即推送，圖表即時重繪。
 *
 * @param {SentimentFilters} filters - 可選的過濾參數，僅有值的欄位會加入查詢；呼叫端建議 useMemo 以穩定依賴。
 * @param {{ starId?: string; pageSize?: number; enabled?: boolean }} [options] - starId、筆數上限、是否啟用查詢（無篩選時可傳 false 省 Reads）
 * @returns {{ data: Array, loading: boolean, error: Error | null, summary: Object }}
 */
export function useSentimentData(filters = EMPTY_FILTERS, options = {}) {
  const { starId = DEFAULT_STAR_ID, pageSize = DEFAULT_PAGE_SIZE, enabled = true } = options
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  const filterEntries = useMemo(() => {
    const map = {
      team: 'voterTeam',
      ageGroup: 'ageGroup',
      gender: 'gender',
      country: 'country',
      city: 'city',
    }
    return Object.entries(map).filter(([key]) => filters[key] != null && String(filters[key]).trim() !== '')
  }, [filters])

  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }
    if (!isFirebaseReady || !db) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)

    const votesRef = collection(db, 'votes')
    const constraints = [
      where('starId', '==', starId),
      ...filterEntries.map(([key, fieldName]) => where(fieldName, '==', filters[key])),
      limit(pageSize),
    ]
    const q = query(votesRef, ...constraints)

    let timeoutId = null
    const clearLoading = () => {
      setLoading(false)
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    timeoutId = setTimeout(() => {
      setLoading(false)
      timeoutId = null
    }, SNAPSHOT_TIMEOUT_MS)

    if (import.meta.env.DEV) console.log("Firebase Fetching [useSentimentData] votes 查詢訂閱 (Collection query)", { starId, filterEntries: filterEntries.length })
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs ?? []
        const list = docs.map((d) => ({ id: d.id, ...d.data() }))
        setData(list)
        clearLoading()
      },
      (err) => {
        setError(err)
        setData([])
        clearLoading()
        if (err?.code === 'failed-precondition' || (err?.message && err.message.includes('index'))) {
          console.warn('[useSentimentData] 請依 Firebase 錯誤訊息中的連結建立複合索引，見 docs/SCHEMA.md')
        }
      }
    )

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      unsubscribe()
    }
  }, [enabled, starId, pageSize, filterEntries, filters])

  /** 從 votes 集合計算與 global_summary 同型的聚合：百分比與理由排名由消費端依此計算 */
  const summary = useMemo(() => {
    const list = data ?? []
    const totalVotes = list.length
    const byStance = Object.fromEntries(STANCE_KEYS.map((k) => [k, 0]))
    const reasonCountsLike = {}
    const reasonCountsDislike = {}
    const countryCounts = {}

    for (const vote of list) {
      const status = vote.status ?? ''
      if (STANCE_KEYS.includes(status)) byStance[status] = (byStance[status] ?? 0) + 1

      const reasons = Array.isArray(vote.reasons) ? vote.reasons : []
      if (PRO_STANCES.has(status)) {
        for (const r of reasons) {
          if (r != null && String(r).trim() !== '') reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1
        }
      } else if (ANTI_STANCES.has(status)) {
        for (const r of reasons) {
          if (r != null && String(r).trim() !== '') reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1
        }
      }

      const cc = String(vote.country ?? '').toUpperCase().slice(0, 2)
      if (cc) {
        const prev = countryCounts[cc] ?? { pro: 0, anti: 0 }
        countryCounts[cc] = {
          pro: prev.pro + (PRO_STANCES.has(status) ? 1 : 0),
          anti: prev.anti + (ANTI_STANCES.has(status) ? 1 : 0),
        }
      }
    }

    return {
      totalVotes,
      ...byStance,
      reasonCountsLike,
      reasonCountsDislike,
      countryCounts,
    }
  }, [data])

  return { data, loading, error, summary }
}
