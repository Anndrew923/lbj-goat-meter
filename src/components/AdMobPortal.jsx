/**
 * AdMobPortal — 插頁廣告全螢幕流程（取代 SimulatedAdPortal）
 *
 * - 監聽 adDismissed 觸發 PaymentService.grantReconPermission() 並執行 onWatched / onClose。
 * - onWatched 可為 async（例如 await saveToGallery）；以 Promise.resolve 串接，不應再彈出中間確認層。
 * - 感官同步：廣告準備載入時震動 [30,50,30]ms，關閉並授予許可後震動 [20,40,20]ms。
 * - 登入頁不渲染：路徑為 /login 時不顯示，避免遮罩登入流程。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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

export default function AdMobPortal({ open = false, onClose, onWatched }) {
  const location = useLocation()
  const { t } = useTranslation('common')
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

  if (!open) return null
  if (location.pathname === '/login') return null

  const portal = (
    <motion.div
      className="framer-motion-stabilizer fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/90"
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('adPortalAria')}
    >
      <div className="text-center px-6 max-w-sm">
        <p className="text-white/95 text-lg font-medium">{t('adPortalLoadingTitle')}</p>
        <p className="mt-2 text-white/60 text-sm">{t('adPortalLoadingSubtitle')}</p>
      </div>
    </motion.div>
  )

  if (typeof document === 'undefined') return portal
  return createPortal(portal, document.body)
}
