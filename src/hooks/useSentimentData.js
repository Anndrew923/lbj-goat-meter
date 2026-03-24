/**
 * useSentimentData — 情緒投票數據的漏斗 Hook（Callable + Session 快取）
 *
 * 設計意圖：
 * - Firestore Rules 已限制 votes 僅可讀「本人」文件，客戶端不得再 getDocs 掃描全集合。
 * - 有篩選時改呼叫 Cloud Function `getFilteredSentimentSummary`（Admin 查詢 + 與前端等價之聚合），結果列仍供消費端做整數分配校準。
 * - 無篩選時：由 WarzoneDataContext 讀 global_summary，本 Hook 在 GlobalSentimentProvider 內會停用查詢。
 *
 * Reads 優化注意：
 * - 後端查詢有 pageSize 上限；Session / localStorage TTL 與 useBarometerQuery debounce 仍適用。
 *
 * 為何需要複合索引 (Composite Indexes)？
 * - Firestore 對「多欄位查詢」有硬性規定：只要在單一查詢中對「多個不同欄位」使用
 *   where()（或 where() 搭配 orderBy()），就必須事先在 Firebase Console 建立對應的
 *   複合索引，否則執行時會拋出錯誤並回傳建立索引的連結。
 *
 * 聯動延遲：通常 < 1 秒（依 Firestore 推送與網路狀況）。
 */

import { useMemo, useCallback } from 'react'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import app, { db, auth, isFirebaseReady, getFirebaseFunctions } from '../lib/firebase'
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
 * 依篩選條件透過 Callable 取得 votes 子集並聚合（漏斗過濾）；與 Session 快取搭配降低重複呼叫。
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
    if (!app) {
      throw new Error('Firebase app not initialized')
    }
    if (!auth?.currentUser) {
      throw new Error('AUTH_REQUIRED')
    }

    if (import.meta.env.DEV) {
      console.log('Firebase Fetching [useSentimentData] getFilteredSentimentSummary (Callable + session cache)', {
        starId,
        filterEntries: filterEntries.length,
        ttlMs,
      })
    }

    const fns = getFirebaseFunctions()
    if (!fns) {
      throw new Error('FUNCTIONS_NOT_READY')
    }
    const call = httpsCallable(fns, 'getFilteredSentimentSummary')
    const { data } = await call({
      starId,
      pageSize,
      filters: {
        team: filters.team,
        ageGroup: filters.ageGroup,
        gender: filters.gender,
        country: filters.country,
        city: filters.city,
      },
    })

    const list = Array.isArray(data?.rows) ? data.rows : []
    const summary =
      data?.summary && typeof data.summary === 'object' && data.summary !== null
        ? data.summary
        : computeSentimentSummary(list)
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
