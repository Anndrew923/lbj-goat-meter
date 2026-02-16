/**
 * useAnalystAuth — 偵查授權狀態與模擬廣告流程（Analytics 區塊變現引擎）
 * 當前會話有效，可寫入 sessionStorage；解鎖後回傳 analystAdPortal 供父層渲染。
 */
import { useState, useRef, useCallback } from 'react'
import SimulatedAdPortal from '../components/SimulatedAdPortal'

const SESSION_KEY_ANALYST = 'analystAuthorized'

export function useAnalystAuth() {
  const [isAnalystAuthorized, setAuthorizedState] = useState(() => {
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY_ANALYST) === 'true'
    } catch {
      return false
    }
  })
  const [showAdPortal, setShowAdPortal] = useState(false)
  const pendingOnWatchedRef = useRef(null)

  const setAnalystAuthorized = useCallback((value) => {
    setAuthorizedState(value)
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (value) sessionStorage.setItem(SESSION_KEY_ANALYST, 'true')
        else sessionStorage.removeItem(SESSION_KEY_ANALYST)
      }
    } catch {}
  }, [])

  const onRequestRewardAd = useCallback((onWatched) => {
    pendingOnWatchedRef.current = onWatched
    setShowAdPortal(true)
  }, [])

  const onAdWatched = useCallback(() => {
    pendingOnWatchedRef.current?.()
    pendingOnWatchedRef.current = null
    setAnalystAuthorized(true)
    setShowAdPortal(false)
  }, [setAnalystAuthorized])

  const onAdClose = useCallback(() => setShowAdPortal(false), [])

  const analystAdPortal = (
    <SimulatedAdPortal
      open={showAdPortal}
      onWatched={onAdWatched}
      onClose={onAdClose}
    />
  )

  return { isAnalystAuthorized, onRequestRewardAd, analystAdPortal }
}
