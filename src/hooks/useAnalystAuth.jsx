/**
 * useAnalystAuth — 偵查授權狀態與模擬廣告流程（全廣告驅動）
 * 會話級：僅存於記憶體，不寫入 Firestore；重新整理或重新登入後重置為 false。
 */
import { useState, useRef, useCallback } from 'react'
import SimulatedAdPortal from '../components/SimulatedAdPortal'

export function useAnalystAuth() {
  const [isAnalystAuthorized, setAuthorizedState] = useState(false)
  const [showAdPortal, setShowAdPortal] = useState(false)
  const pendingOnWatchedRef = useRef(null)

  const setAnalystAuthorized = useCallback((value) => {
    setAuthorizedState(value)
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
