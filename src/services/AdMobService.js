/**
 * AdMobService — AdMob 插頁廣告封裝（Security First）
 *
 * 設計意圖：
 * - 本模組為「單純參數接收者」：不呼叫任何 React Hook，所有廣告 ID / 測試旗標由呼叫端
 *   （元件層）透過 useAdMobConfig() 取得後傳入，確保符合 Hooks 規則且具可測試性。
 * - 嚴格測試模式：initialize() 時傳入 testingDevices 與 initializeForTesting，
 *   僅在指定設備上以正式廣告請求但不計入有效流量，避免封號。
 * - 僅在原生平台 (Capacitor) 執行；Web 不呼叫 AdMob。
 *
 * 可測試性：getInterstitialAdId、getUseTestInterstitialFromEnv、getEffectiveInterstitialAdId
 * 均為純函數，可於單元測試中獨立驗證或透過依賴注入 mock 環境變數。
 */
import { useMemo } from 'react'
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

/** 取得插頁廣告單元 ID：優先環境變數，後備為 Google 官方測試 ID（純函數，可測試） */
export function getInterstitialAdId() {
  const id = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID
  return id && String(id).trim() ? id : GOOGLE_TEST_INTERSTITIAL_ID
}

/**
 * 是否使用測試廣告（純函數，從 env 讀取；不為 Hook，供 useAdMobConfig 與單元測試使用）
 * VITE_ADMOB_USE_TEST_IDS=true 或無 VITE_ADMOB_INTERSTITIAL_ID 時為 true。
 */
export function getUseTestInterstitialFromEnv() {
  const envId = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID
  const useTest = import.meta.env.VITE_ADMOB_USE_TEST_IDS === 'true'
  return useTest || !envId || !String(envId).trim()
}

/**
 * 依「是否使用測試」回傳實際請求用的插頁 ID（純函數，可測試）
 * @param {boolean} useTest - 若 true 回傳 Google 官方測試 ID，否則回傳 getInterstitialAdId()
 */
export function getEffectiveInterstitialAdId(useTest) {
  return useTest ? GOOGLE_TEST_INTERSTITIAL_ID : getInterstitialAdId()
}

/**
 * 自定義 Hook：在元件層取得 AdMob 插頁用 adId / isTesting，供傳入 AdMobService 方法。
 * 設計意圖：ID 與測試旗標邏輯僅在 Hook 內處理，服務層不直接讀取 env 或呼叫 Hook。
 */
export function useAdMobConfig() {
  return useMemo(() => {
    const isTesting = getUseTestInterstitialFromEnv()
    return {
      adId: getEffectiveInterstitialAdId(isTesting),
      isTesting,
    }
  }, [])
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
 * 準備插頁廣告（純參數接收者：adId / isTesting 由呼叫端透過 useAdMobConfig() 傳入）
 * @param {Object} options - 必須包含 adId（string）、isTesting（boolean），由元件層 useAdMobConfig() 提供
 */
export async function prepareInterstitial(options) {
  if (!isNative()) return
  if (!options || options.adId == null || options.isTesting === undefined) {
    console.warn('[AdMobService] prepareInterstitial 建議傳入 { adId, isTesting }，請由 useAdMobConfig() 取得')
  }
  const adId = options?.adId ?? getEffectiveInterstitialAdId(getUseTestInterstitialFromEnv())
  const isTesting = options?.isTesting ?? getUseTestInterstitialFromEnv()

  await AdMob.prepareInterstitial({
    adId,
    isTesting,
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
