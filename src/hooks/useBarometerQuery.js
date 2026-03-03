/**
 * useBarometerQuery — 通用查詢壓力計引擎
 *
 * 設計意圖：
 * - 提供「Session 記憶體快取 + localStorage TTL + Debounce + 配額扣除」的一站式保護。
 * - 完全與 UI、廣告與特定資料源解耦，只關注 queryFn / cacheKey / quota。
 *
 * 使用方式：
 * - 傳入 cacheKey（必須穩定）、enabled、ttlMs、queryFn（回傳陣列或資料）以及
 *   quota（當前配額）、consumeQuota（扣除 1 單位配額）與 onInsufficientQuota（配額不足時的回調）。
 */
import { useEffect, useState, useRef } from 'react'

/** Session 級記憶體快取：同一會話內相同查詢 key 僅打一次遠端查詢（可套用於任意資料源） */
const sessionCache = new Map()

export function useBarometerQuery({
  cacheKey,
  enabled,
  ttlMs,
  queryFn,
  quota = null,
  consumeQuota,
  onInsufficientQuota,
}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)
  const debounceTimerRef = useRef(null)

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    if (!enabled) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }

    const now = Date.now()

    setLoading(true)
    setError(null)

    // 1) Session 級快取：同一會話內相同查詢直接回傳記憶體結果
    const sessionHit = sessionCache.get(cacheKey)
    if (sessionHit && Array.isArray(sessionHit.data)) {
      setData(sessionHit.data)
      setLoading(false)
      return
    }

    // 2) localStorage 快取：SWR 行為，TTL 內直接使用快取、過期才打遠端
    let shouldFetchFromNetwork = true
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(cacheKey)
        if (raw) {
          const cached = JSON.parse(raw)
          if (cached && Array.isArray(cached.data) && typeof cached.updatedAt === 'number') {
            const age = now - cached.updatedAt
            setData(cached.data)
            if (age < ttlMs) {
              shouldFetchFromNetwork = false
              setLoading(false)
            }
          }
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[useBarometerQuery] 讀取快取失敗，改為直接從遠端取得：', e)
        }
      }
    }

    if (!shouldFetchFromNetwork) {
      return
    }

    // 3) 無任何快取可用且配額不足時：不再打遠端，並通知上層重置權限或提示用戶
    if (typeof quota === 'number' && quota <= 0) {
      setLoading(false)
      if (typeof onInsufficientQuota === 'function') {
        onInsufficientQuota()
      }
      return
    }

    let cancelled = false
    const DEBOUNCE_MS = 650

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await queryFn()
        if (cancelled) return
        const list = Array.isArray(result) ? result : [result]
        setData(list)
        setLoading(false)

        // 寫入 Session 記憶體快取：本頁面生命週期內不再重複 Reads
        sessionCache.set(cacheKey, { data: list })

        // 4) 實際發生遠端查詢且未命中快取時才扣除 1 單位配額
        if (typeof quota === 'number' && typeof consumeQuota === 'function') {
          const ok = consumeQuota()
          if (!ok && typeof onInsufficientQuota === 'function') {
            onInsufficientQuota()
          }
        }

        // localStorage 持久化：延續 SWR + TTL 策略
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(
              cacheKey,
              JSON.stringify({
                data: list,
                updatedAt: now,
              }),
            )
          } catch (e) {
            if (import.meta.env.DEV) {
              console.warn('[useBarometerQuery] 寫入快取失敗（可忽略）：', e)
            }
          }
        }
      } catch (err) {
        if (cancelled) return
        setError(err)
        setData([])
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [cacheKey, enabled, ttlMs, queryFn, quota, consumeQuota, onInsufficientQuota])

  return { data, loading, error }
}

