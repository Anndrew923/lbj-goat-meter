/**
 * AdMobService — AdMob 插頁廣告封裝（Security First）
 *
 * - 嚴格測試模式：initialize() 時傳入 testingDevices 與 initializeForTesting，
 *   僅在指定設備上以正式廣告請求但不計入有效流量，避免封號。
 * - 未發布前可優先使用 Google 官方測試插頁 ID 作為後備。
 * - 僅在原生平台 (Capacitor) 執行；Web 不呼叫 AdMob。
 */
import { Capacitor } from '@capacitor/core'
import {
  AdMob,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob'

const GOOGLE_TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712'

/** 是否為原生平台 */
function isNative() {
  return Capacitor.isNativePlatform()
}

/** 取得插頁廣告單元 ID：優先環境變數，後備為 Google 官方測試 ID */
export function getInterstitialAdId() {
  const id = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID
  return id && String(id).trim() ? id : GOOGLE_TEST_INTERSTITIAL_ID
}

/** 是否使用測試廣告（VITE_ADMOB_USE_TEST_IDS=true 或無環境變數時為 true） */
export function useTestInterstitialId() {
  const envId = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID
  const useTest = import.meta.env.VITE_ADMOB_USE_TEST_IDS === 'true'
  return useTest || !envId || !String(envId).trim()
}

/** 實際請求用的插頁 ID：全域測試鎖定時強制使用 Google 官方測試 ID，否則用 getInterstitialAdId() */
function getEffectiveInterstitialAdId() {
  return useTestInterstitialId() ? GOOGLE_TEST_INTERSTITIAL_ID : getInterstitialAdId()
}

/**
 * 初始化 AdMob（嚴格測試模式）
 * 必須傳入 testingDevices 並設定 initializeForTesting，以防封號。
 */
export async function initializeAdMob() {
  if (!isNative()) return

  const testingDevices = (import.meta.env.VITE_ADMOB_TEST_DEVICE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  await AdMob.initialize({
    testingDevices: testingDevices.length > 0 ? testingDevices : undefined,
    initializeForTesting: true,
  })
}

/**
 * 準備插頁廣告
 * 全域測試鎖定時自動將所有請求導向 Google 官方測試 ID，不傳入則依 useTestInterstitialId()。
 * @param {Object} [options] - adId、isTesting（未傳則使用 getEffectiveInterstitialAdId + useTestInterstitialId）
 */
export async function prepareInterstitial(options = {}) {
  if (!isNative()) return

  const useTest = options.isTesting ?? useTestInterstitialId()
  const adId = options.adId ?? getEffectiveInterstitialAdId()

  await AdMob.prepareInterstitial({
    adId,
    isTesting: useTest,
  })
}

/** 顯示已準備的插頁廣告 */
export async function showInterstitial() {
  if (!isNative()) return
  await AdMob.showInterstitial()
}

/**
 * 訂閱插頁廣告事件（Loaded / Dismissed / FailedToLoad / FailedToShow / Showed）
 * @param {string} eventName - InterstitialAdPluginEvents 常數
 * @param {Function} callback
 * @returns {Promise<{ remove: () => Promise<void> }>}
 */
export async function addInterstitialListener(eventName, callback) {
  if (!isNative()) {
    return Promise.resolve({ remove: async () => {} })
  }
  return AdMob.addListener(eventName, callback)
}

export { InterstitialAdPluginEvents }
