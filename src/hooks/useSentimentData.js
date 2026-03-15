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

import { useMemo, useCallback } from 'react'
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db, auth, isFirebaseReady } from '../lib/firebase'
import { STANCE_KEYS, PRO_STANCES, ANTI_STANCES } from '../lib/constants'
import { useBarometerQuery } from './useBarometerQuery'

/** 預設球星 ID，與 SCHEMA 中 starId 對應 */
const DEFAULT_STAR_ID = 'lbj'

/** 單次查詢上限，避免一次拉取過多文件 */
const DEFAULT_PAGE_SIZE = 200

/** 快取版本與 TTL：無篩選＝較短；進階篩選＝較長以節省 Reads */
const SENTIMENT_CACHE_VERSION = 'v1'
const BASE_CACHE_TTL_MS = 5 * 60 * 1000 // 5 分鐘：全球大盤（無篩選）
const ADVANCED_CACHE_TTL_MS = 30 * 60 * 1000 // 30 分鐘：進階篩選，Reads 成本較高

function buildCacheKey(starId, filters) {
  const safeStarId = String(starId || '').trim() || DEFAULT_STAR_ID
  if (!filters || typeof filters !== 'object') {
    return `sentiment:${SENTIMENT_CACHE_VERSION}:${safeStarId}:nofilters`
  }
  // 依 key 排序後序列化，確保同一組 filters 產出穩定 key
  const normalizedEntries = Object.entries(filters)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
  const normalized = Object.fromEntries(normalizedEntries)
  return `sentiment:${SENTIMENT_CACHE_VERSION}:${safeStarId}:${JSON.stringify(
    normalized
  )}`
}

/** 是否含有有效篩選條件（任一欄位非空），供消費端決定用靜態或動態數據 */
export function hasActiveFilters(filters) {
  if (!filters || typeof filters !== 'object') return false
  return Object.values(filters).some((v) => v != null && String(v).trim() !== '')
}

/** 穩定空篩選參考，避免傳入字面量 {} 導致 useEffect 依賴每輪都變、觸發 Maximum update depth */
export const EMPTY_FILTERS = Object.freeze({})

/** 從 votes 列表計算與 global_summary 同型的聚合結果 */
function computeSentimentSummary(list) {
  const votes = Array.isArray(list) ? list : []
  const totalVotes = votes.length
  const byStance = Object.fromEntries(STANCE_KEYS.map((k) => [k, 0]))
  const reasonCountsLike = {}
  const reasonCountsDislike = {}
  const countryCounts = {}

  for (const vote of votes) {
    const status = vote?.status ?? ''
    if (STANCE_KEYS.includes(status)) {
      byStance[status] = (byStance[status] ?? 0) + 1
    }

    const reasons = Array.isArray(vote?.reasons) ? vote.reasons : []
    if (PRO_STANCES.has(status)) {
      for (const r of reasons) {
        if (r != null && String(r).trim() !== '') {
          reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1
        }
      }
    } else if (ANTI_STANCES.has(status)) {
      for (const r of reasons) {
        if (r != null && String(r).trim() !== '') {
          reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1
        }
      }
    }

    const cc = String(vote?.country ?? '').toUpperCase().slice(0, 2)
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
}

/** 將本次查詢結果的聚合快照寫入 analytics_pro/{cacheKey}，供後續直接讀取預聚合文件 */
async function persistAnalyticsPro(cacheKey, starId, filters, summary) {
  if (!isFirebaseReady || !db) return
  if (!cacheKey) return
  try {
    const ref = doc(db, 'analytics_pro', cacheKey)
    const ownerUid = auth?.currentUser?.uid ?? null
    await setDoc(
      ref,
      {
        starId: String(starId || '').trim() || DEFAULT_STAR_ID,
        summary: summary ?? {},
        breakdown: {}, // 預留給未來更細粒度分析（例如時間序列 / 雷達圖）
        filters: filters && typeof filters === 'object' ? filters : {},
        generatedAt: serverTimestamp(),
        ownerUid,
      },
      { merge: true },
    )
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[useSentimentData] 寫入 analytics_pro 快照失敗（可忽略）：', e)
    }
  }
}

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
  const {
    starId = DEFAULT_STAR_ID,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
    remainingPoints = null,
    consumePoint,
    onEnergyExhausted,
  } = options

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

  const cacheKey = buildCacheKey(starId, filters)
  const ttlMs = hasActiveFilters(filters) ? ADVANCED_CACHE_TTL_MS : BASE_CACHE_TTL_MS

  const queryFn = useCallback(async () => {
    const votesRef = collection(db, 'votes')
    const constraints = [
      where('starId', '==', starId),
      ...filterEntries.map(([key, fieldName]) => where(fieldName, '==', filters[key])),
      limit(pageSize),
    ]
    const q = query(votesRef, ...constraints)

    if (import.meta.env.DEV) {
      console.log('Firebase Fetching [useSentimentData] votes 查詢 (getDocs + session cache)', {
        starId,
        filterEntries: filterEntries.length,
        ttlMs,
      })
    }

    const snapshot = await getDocs(q)
    const docs = snapshot.docs ?? []
    const list = docs.map((d) => ({ id: d.id, ...d.data() }))

    // 本次實際打到 Firestore 後，將聚合結果預寫入 analytics_pro，作為後續相同 cacheKey 的預算快照
    const summary = computeSentimentSummary(list)
    await persistAnalyticsPro(cacheKey, starId, filters, summary)

    return list
  }, [starId, pageSize, filterEntries, filters, ttlMs, cacheKey])

  const { data, loading, error } = useBarometerQuery({
    cacheKey,
    enabled: enabled && isFirebaseReady && !!db,
    ttlMs,
    quota: remainingPoints,
    consumeQuota: consumePoint,
    onInsufficientQuota: onEnergyExhausted,
    queryFn,
  })

  const summary = useMemo(() => {
    return computeSentimentSummary(data ?? [])
  }, [data])

  return { data, loading, error, summary }
}
