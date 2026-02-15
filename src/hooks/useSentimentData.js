/**
 * useSentimentData — 情緒投票數據的實時漏斗 Hook（onSnapshot）
 *
 * 設計意圖：
 * - 以 onSnapshot 實時監聽 votes 集合，任一筆投票變動（本地或全球）即推送到 UI，圖表與百分比即時跳動，無需手動重新整理。
 * - 支援「全球 → 國家 → 城市」與「年齡 / 性別 / 球隊」的多維度交叉查詢。
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
import { db } from '../lib/firebase'

/** 預設球星 ID，與 SCHEMA 中 starId 對應 */
const DEFAULT_STAR_ID = 'lbj'

/** 單次查詢上限，避免一次拉取過多文件 */
const DEFAULT_PAGE_SIZE = 200

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
 * @param {{ starId?: string; pageSize?: number }} [options] - starId 與筆數上限
 * @returns {{ data: Array, loading: boolean, error: Error | null }}
 */
export function useSentimentData(filters = {}, options = {}) {
  const { starId = DEFAULT_STAR_ID, pageSize = DEFAULT_PAGE_SIZE } = options
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
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
    if (!db) {
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

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs ?? []
        const list = docs.map((d) => ({ id: d.id, ...d.data() }))
        setData(list)
        setLoading(false)
      },
      (err) => {
        setError(err)
        setData([])
        setLoading(false)
        if (err?.code === 'failed-precondition' || (err?.message && err.message.includes('index'))) {
          console.warn('[useSentimentData] 請依 Firebase 錯誤訊息中的連結建立複合索引，見 docs/SCHEMA.md')
        }
      }
    )

    return () => unsubscribe()
  }, [starId, pageSize, filterEntries, filters])

  return { data, loading, error }
}
