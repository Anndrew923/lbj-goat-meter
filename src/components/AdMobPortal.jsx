/**
 * AdMobPortal — 插頁廣告全螢幕流程（取代 SimulatedAdPortal）
 *
 * - 監聽 adDismissed 觸發 PaymentService.grantReconPermission() 並執行 onWatched / onClose。
 * - 感官同步：廣告準備載入時震動 [30,50,30]ms，關閉並授予許可後震動 [20,40,20]ms。
 * - 登入頁不渲染：路徑為 /login 時不顯示，避免遮罩登入流程。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { triggerHapticPattern } from '../utils/hapticUtils'
import {
  prepareInterstitial,
  showInterstitial,
  addInterstitialListener,
  InterstitialAdPluginEvents,
} from '../services/AdMobService'
import { grantReconPermission } from '../services/PaymentService'
import { Capacitor } from '@capacitor/core'

const HAPTIC_LOADING = [30, 50, 30]
const HAPTIC_DISMISSED = [20, 40, 20]

export default function AdMobPortal({ open = false, onClose, onWatched }) {
  const location = useLocation()
  const onWatchedRef = useRef(onWatched)
  const onCloseRef = useRef(onClose)
  const removeListenersRef = useRef(null)

  onWatchedRef.current = onWatched
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const isNative = Capacitor.isNativePlatform()
    if (!isNative) {
      grantReconPermission()
      onWatchedRef.current?.()
      onCloseRef.current?.()
      return
    }

    let removed = false
    const removeFns = []

    const handleLoaded = () => {
      if (removed) return
      triggerHapticPattern(HAPTIC_LOADING)
    }

    const handleDismissed = () => {
      if (removed) return
      triggerHapticPattern(HAPTIC_DISMISSED)
      grantReconPermission()
      onWatchedRef.current?.()
      onCloseRef.current?.()
    }

    const handleFailed = () => {
      if (removed) return
      onCloseRef.current?.()
    }

    const setup = async () => {
      const unloadLoaded = await addInterstitialListener(
        InterstitialAdPluginEvents.Loaded,
        handleLoaded
      )
      removeFns.push(() => unloadLoaded.remove())
      removeListenersRef.current = () =>
        Promise.all(removeFns.map((fn) => fn().catch(() => {})))

      const unloadDismissed = await addInterstitialListener(
        InterstitialAdPluginEvents.Dismissed,
        handleDismissed
      )
      removeFns.push(() => unloadDismissed.remove())

      const unloadFailedLoad = await addInterstitialListener(
        InterstitialAdPluginEvents.FailedToLoad,
        handleFailed
      )
      removeFns.push(() => unloadFailedLoad.remove())

      const unloadFailedShow = await addInterstitialListener(
        InterstitialAdPluginEvents.FailedToShow,
        handleFailed
      )
      removeFns.push(() => unloadFailedShow.remove())

      removeListenersRef.current = () =>
        Promise.all(removeFns.map((fn) => fn().catch(() => {})))

      if (removed) return
      await prepareInterstitial()
      if (removed) return
      await showInterstitial()
    }

    setup().catch(() => {
      if (!removed) onCloseRef.current?.()
    })

    return () => {
      removed = true
      removeListenersRef.current?.()
    }
  }, [open])

  if (!open) return null
  if (location.pathname === '/login') return null

  const portal = (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label="廣告"
    >
      <div className="text-center px-6 max-w-sm">
        <p className="text-white/95 text-lg font-medium">正在獲取戰報生成權限...</p>
        <p className="mt-2 text-white/60 text-sm">（廣告載入中）</p>
      </div>
    </motion.div>
  )

  if (typeof document === 'undefined') return portal
  return createPortal(portal, document.body)
}
