/**
 * AdMobPortal — 插頁廣告全螢幕流程（取代 SimulatedAdPortal）
 *
 * - 監聽 adDismissed 觸發 PaymentService.grantReconPermission() 並執行 onWatched / onClose。
 * - onWatched 可為 async（例如 await saveToGallery）；以 Promise.resolve 串接，不應再彈出中間確認層。
 * - 感官同步：廣告準備載入時震動 [30,50,30]ms，關閉並授予許可後震動 [20,40,20]ms。
 * - 登入頁不渲染：路徑為 /login 時不顯示，避免遮罩登入流程。
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import AdPreloadOverlay from './AdPreloadOverlay'
import { triggerHapticPattern } from '../utils/hapticUtils'
import {
  useAdMobConfig,
  prepareInterstitial,
  showInterstitial,
  addInterstitialListener,
  InterstitialAdPluginEvents,
} from '../services/AdMobService'
import { grantReconPermission } from '../services/PaymentService'
import { Capacitor } from '@capacitor/core'

const HAPTIC_LOADING = [30, 50, 30]
const HAPTIC_DISMISSED = [20, 40, 20]

/**
 * adContext 對應表：
 *   'battle_card' → ad_prompt_battle_card（Battle Card 匯出）
 *   'intel'       → ad_prompt_intel（情報中樞解鎖）
 *   'extra_vote'  → ad_prompt_extra_vote（重置立場）
 *   undefined     → 維持舊版 adPortalLoadingTitle（通用後備）
 */
export default function AdMobPortal({ open = false, onClose, onWatched, adContext }) {
  const location = useLocation()
  const adMobConfig = useAdMobConfig()
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
      void Promise.resolve(onWatchedRef.current?.()).finally(() => {
        onCloseRef.current?.()
      })
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
      void Promise.resolve(onWatchedRef.current?.()).finally(() => {
        onCloseRef.current?.()
      })
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
      await prepareInterstitial({ adId: adMobConfig.adId, isTesting: adMobConfig.isTesting })
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
  }, [open, adMobConfig.adId, adMobConfig.isTesting])

  if (location.pathname === '/login') return null

  // AdPreloadOverlay 內部使用 AnimatePresence + createPortal，傳入 open 控制顯示
  return (
    <AdPreloadOverlay
      open={open}
      adContext={adContext}
    />
  )
}
