/**
 * useSentimentData — 情緒投票數據的漏斗過濾 Hook
 *
 * 設計意圖：
 * - 支援「全球 → 國家 → 城市」與「年齡 / 性別 / 球隊」的多維度交叉查詢。
 * - 過濾參數動態組合，僅傳入有值的條件以對應不同 UI 篩選情境；無任何篩選時僅依 starId 查詢（該球星全部投票）。
 *
 * 為何需要複合索引 (Composite Indexes)？
 * - Firestore 對「多欄位查詢」有硬性規定：只要在單一查詢中對「多個不同欄位」使用
 *   where()（或 where() 搭配 orderBy()），就必須事先在 Firebase Console 建立對應的
 *   複合索引，否則執行時會拋出錯誤並回傳建立索引的連結。
 * - 原因：Firestore 的查詢引擎依索引掃描結果集；多條件等值查詢需要一個「聯合索引」
 *   （欄位順序與查詢條件一致）才能高效執行，無法僅靠單欄索引組合。
 * - 潛在影響：每種 where 欄位組合都可能對應一種索引；若漏斗維度過多，需在
 *   docs/SCHEMA.md 預先列出常用組合，並在 Console 建立，避免上線後首次查詢才報錯。
 *
 * 測試重點建議：
 * - 無篩選、單一篩選、多條件篩選是否皆回傳預期筆數。
 * - 未建索引時是否收到明確錯誤訊息（含索引連結）。
 */

import { useEffect, useState, useMemo } from 'react'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
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
 * 依篩選條件取得 votes 集合的情緒數據（漏斗過濾）。
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
    let cancelled = false
    setLoading(true)
    setError(null)

    const run = async () => {
      try {
        const votesRef = collection(db, 'votes')
        const constraints = [
          where('starId', '==', starId),
          ...filterEntries.map(([key, fieldName]) => where(fieldName, '==', filters[key])),
          limit(pageSize),
        ]
        const q = query(votesRef, ...constraints)
        const snapshot = await getDocs(q)
        if (cancelled) return
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setData(list)
      } catch (err) {
        if (!cancelled) {
          setError(err)
          setData([])
          if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
            console.warn('[useSentimentData] 請依 Firebase 錯誤訊息中的連結建立複合索引，見 docs/SCHEMA.md')
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [starId, pageSize, filterEntries, filters])

  return { data, loading, error }
}
