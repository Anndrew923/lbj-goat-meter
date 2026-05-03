/**
 * useAnalystAuth — 偵查授權狀態與廣告解鎖流程（全廣告驅動）
 * 會話級授權 + 本地情報能量點數（localStorage 持久化），避免重複觀看廣告仍可自由探索。
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import AdMobPortal from '../components/AdMobPortal'

const ENERGY_STORAGE_KEY = 'analyst_insight_energy_v1'
// Intelligence Volatility：預設 10 分鐘未使用即視為過期；可依 B2B 需求調整為 24h 等級。
export const ENERGY_EXPIRY_THRESHOLD_MS = 10 * 60 * 1000

export function useAnalystAuth() {
  const [isAnalystAuthorized, setAuthorizedState] = useState(false)
  const [showAdPortal, setShowAdPortal] = useState(false)
  const [remainingPoints, setRemainingPoints] = useState(0)
  const pendingOnWatchedRef = useRef(null)

  const setAnalystAuthorized = useCallback((value) => {
    setAuthorizedState(value)
  }, [])

  const handleEnergyExhausted = useCallback(() => {
    setAuthorizedState(false)
  }, [])

  const persistEnergySnapshot = useCallback((points, ts) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        ENERGY_STORAGE_KEY,
        JSON.stringify({
          points,
          lastActiveAt: ts,
        }),
      )
    } catch {
      // 靜默失敗：不阻斷體驗
    }
  }, [])

  // 初始載入與從背景回到前景時：從 localStorage 還原情報能量並套用 10 分鐘過期邏輯
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hydrateWithExpiry = () => {
      try {
        const raw = window.localStorage.getItem(ENERGY_STORAGE_KEY)
        if (raw == null) {
          setRemainingPoints(0)
          return
        }

        let points = 0
        let lastActiveAt = 0
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && typeof parsed.points === 'number') {
            points = parsed.points || 0
            lastActiveAt = typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : 0
          } else {
            const legacy = Number(raw)
            if (Number.isFinite(legacy) && legacy > 0) {
              points = legacy
            }
          }
        } catch {
          const legacy = Number(raw)
          if (Number.isFinite(legacy) && legacy > 0) {
            points = legacy
          }
        }

        const now = Date.now()
        const hasExpiryInfo = Number.isFinite(lastActiveAt) && lastActiveAt > 0
        const expired =
          points > 0 &&
          hasExpiryInfo &&
          now - lastActiveAt > ENERGY_EXPIRY_THRESHOLD_MS

        if (expired) {
          // 情報能量過期：歸零並收回授權
          setRemainingPoints(0)
          persistEnergySnapshot(0, now)
          handleEnergyExhausted()
          return
        }

        // 未過期：還原點數；若無 lastActiveAt 則視為剛活躍
        setRemainingPoints(points > 0 ? points : 0)
        if (!hasExpiryInfo && points > 0) {
          persistEnergySnapshot(points, now)
        }
      } catch {
        // 靜默失敗即可，能量僅為 UX 強化，不影響主流程
        setRemainingPoints(0)
      }
    }

    hydrateWithExpiry()

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        hydrateWithExpiry()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [handleEnergyExhausted, persistEnergySnapshot])

  const grantEnergy = useCallback(
    (amount) => {
      setRemainingPoints((prev) => {
        const base = Number.isFinite(prev) && prev > 0 ? prev : 0
        const next = base + amount
        const now = Date.now()
        persistEnergySnapshot(next, now)
        return next
      })
    },
    [persistEnergySnapshot],
  )

  const consumePoint = useCallback(() => {
    let didConsume = false
    setRemainingPoints((prev) => {
      if (!Number.isFinite(prev) || prev <= 0) return prev
      const next = prev - 1
      didConsume = true
      const now = Date.now()
      persistEnergySnapshot(next, now)
      return next
    })
    return didConsume
  }, [persistEnergySnapshot])

  const onRequestRewardAd = useCallback((onWatched) => {
    pendingOnWatchedRef.current = onWatched
    setShowAdPortal(true)
  }, [])

  const onAdWatched = useCallback(() => {
    pendingOnWatchedRef.current?.()
    pendingOnWatchedRef.current = null
    setAnalystAuthorized(true)
    // 每次成功觀看廣告，核發 30 點情報能量（累加制）
    grantEnergy(30)
    setShowAdPortal(false)
  }, [setAnalystAuthorized, grantEnergy])

  const onAdClose = useCallback(() => setShowAdPortal(false), [])

  const analystAdPortal = (
    <AdMobPortal
      open={showAdPortal}
      onWatched={onAdWatched}
      onClose={onAdClose}
    />
  )

  return {
    isAnalystAuthorized,
    remainingPoints,
    consumePoint,
    onEnergyExhausted: handleEnergyExhausted,
    onRequestRewardAd,
    analystAdPortal,
  }
}
