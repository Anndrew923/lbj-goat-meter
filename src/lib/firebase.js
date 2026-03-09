/**
 * Firebase 核心配置 — 顯式初始化（Explicit Config）與 Singleton
 *
 * 設計意圖：
 * - 棄用 Firebase Hosting 的 /__/firebase/init.json 自動注入：該路徑僅在「已部署 Hosting 的
 *   firebaseapp.com」上存在，本地或自架網域會產生 404，且將配置綁在 Hosting 不利多環境與自架部署。
 * - 改由環境變數手動建構 firebaseConfig，利於 Staging/Prod 分離（.env.development / .env.production
 *   或 CI 注入），且敏感資訊僅存於 .env.local 或伺服器環境，不進版控。
 * - 單例：全域單一 App/Auth/Firestore，避免重複 initializeApp 與連線膨脹。
 * - App Check：在 initializeApp 之後、任何 db 請求前完成初始化，確保僅正版 App 請求可進 Firestore。
 *
 * 登入故障排查（Director's Note）：
 * - 環境變數：.env 的 VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID 需與 Firebase 專案設定完全一致；修改後須重啟 npm run dev。
 * - Sign-in method：Firebase Console > Authentication > Sign-in method，確認 Google 為「已啟用」。
 * - Authorized domains：Authentication > Settings > Authorized domains，加入本地網址（如 localhost）。
 *
 * App Check 故障排查（403 / 401）：
 * - 若開發時遇到 403，請確認是否已將瀏覽器產生的 Debug Token 填入 Firebase Console 的 App Check 白名單中。
 *   （Debug Token 會在啟用 Debug 時於 Console 印出，需在 Firebase Console > App Check > 應用程式的「管理 debug token」中新增。）
 * - 若在 localhost 出現 reCAPTCHA 的 401 Unauthorized：多因 reCAPTCHA 金鑰未允許 localhost 網域。
 *   可於開發環境在 .env.local 設定 VITE_APP_CHECK_SKIP_IN_DEV=1，跳過 App Check 初始化以消除 401（正式環境不會讀取此變數）。
 *
 * 潛在影響：多專案（Multi-tenancy）時需改為 getApp(name) 或工廠模式；缺必要變數時不初始化，
 *           由呼叫端依 isFirebaseReady 決定是否使用 Auth/Firestore。
 * 備註：Production Android 環境未來需切換或並行 PlayIntegrityProvider。
 */
import { initializeApp } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore'

// Bruce: 這是 Standard v3 專用版，已徹底移除 Enterprise (Lite) 分支邏輯

/**
 * 初始化 Firebase App Check
 * 強制使用 reCAPTCHA v3 Standard
 */
const initAppCheck = (app) => {
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  const siteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY;

  if (!siteKey) {
    console.warn('[Firebase] 找不到 App Check Site Key，略過初始化。');
    return null;
  }

  try {
    // 強制使用 ReCaptchaV3Provider，確保對接的是標準版金鑰
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    console.log('[Firebase] App Check 已啟用 (reCAPTCHA v3 Standard)');
    return appCheck;
  } catch (error) {
    console.error('[Firebase] App Check 初始化失敗:', error);
    return null;
  }
};

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
]
function buildConfig() {
  const env = import.meta.env
  const missing = requiredKeys.filter((key) => !env[key]?.trim())
  if (missing.length) {
    if (import.meta.env.DEV) {
      console.error(
        '[Firebase] 缺少必要環境變數:',
        missing.join(', '),
        '— 請複製 .env.example 或 .env.local.example 為 .env 或 .env.local 並填入 Firebase 專案設定。'
      )
    }
    return null
  }
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
  }
}

let app = null
let auth = null
let db = null
let googleProvider = null
/** App Check 是否已成功啟用；用於 UI 顯示「數據經實時驗證」等公信力標籤的防禦性邏輯。 */
let appCheckEnabled = false
/** App Check 實例：用於 Transaction 前強制刷新 Token，確保 100% 嚴謹模式通過規則。 */
let appCheckInstance = null

const config = buildConfig()
if (import.meta.env.DEV) {
  console.log('🛠️ Firebase Config:', config)
  console.log('🛠️ 環境變數檢查:', {
    key: !!import.meta.env.VITE_FIREBASE_API_KEY,
    domain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  })
}
if (config) {
  try {
    app = initializeApp(config)
    // 診斷：確認實際連線的專案與 App，避免改錯 App Check 的應用程式
    if (typeof window !== 'undefined') {
      console.log('[Firebase] 目前連線：projectId =', config.projectId, '| appId =', config.appId)
    }

    // App Check：必須在 db 請求前完成，僅正版 App 請求可進 Firestore
    if (typeof window !== 'undefined') {
      appCheckInstance = initAppCheck(app)
      appCheckEnabled = !!appCheckInstance
    }

    auth = getAuth(app)
    // 《最強肉體》長輪詢配置：自動偵測長輪詢，減少 WebChannel 在開發環境的連線報錯
    // 緩存策略：改用 FirestoreSettings.localCache（persistentLocalCache）取代已棄用的 enableIndexedDbPersistence，優先讀取本地 IndexedDB
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      ...(typeof window !== 'undefined' && {
        localCache: persistentLocalCache({}),
      }),
    })
    googleProvider = new GoogleAuthProvider()
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Firebase] 初始化失敗，Auth/Firestore 將不可用:', err?.message ?? err)
    }
  }
}

/** 是否已成功初始化；未設定或初始化失敗時為 false，呼叫端應避免使用 auth/db */
export const isFirebaseReady = Boolean(auth && db)

/** 是否已啟用 App Check（獨立設備與正版應用驗證）；異常時 UI 可隱藏或灰化「數據經實時驗證」等標籤。 */
export function hasValidAppCheck() {
  return appCheckEnabled
}

/**
 * 在執行多表聯動 Transaction 前強制取得新鮮的 App Check Token，確保 100% 嚴謹模式規則通過。
 * 設計意圖：嚴謹模式下 hasValidAppCheck() 要求 request.appCheck 有效，
 * 若 Token 即將過期或剛過期，先刷新可避免 Transaction 提交時 403。
 * 401 時會捕捉並拋出明確錯誤訊息，由呼叫端顯示，避免 App 卡死或未處理的 rejection。
 * @returns {Promise<void>} 若 App Check 未啟用則直接 resolve；否則 await getToken(forceRefresh: true) 後 resolve
 */
export async function ensureFreshAppCheckToken() {
  if (!appCheckInstance || !appCheckEnabled) {
    // Production 診斷：若從未啟用，投票會 403；原因見上方初始化時的 console 訊息
    if (typeof window !== 'undefined' && !import.meta.env.DEV) {
      console.warn('[Firebase] App Check 未啟用，此請求將不會帶 App Check token，嚴謹規則下會 403')
    }
    return
  }
  try {
    // forceRefresh: true — 確保不使用舊快取權杖，嚴謹模式規則通過
    await getToken(appCheckInstance, true)
  } catch (err) {
    const msg = err?.message ?? String(err)
    const is401 = msg.includes('401') || err?.code === 'app-check/unknown' || /unauthorized|401/i.test(msg)
    console.error(
      '[Firebase] App Check Token 取得失敗，請確認 reCAPTCHA 金鑰與網域設定。',
      is401 ? '（可能為 401 Unauthorized：reCAPTCHA Console 授權網域需包含目前網址）' : '',
      '原始錯誤:',
      msg
    )
    const friendlyMessage = is401
      ? '驗證失敗（401）：請確認 reCAPTCHA 金鑰與授權網域已包含此站，或聯絡管理員。'
      : `驗證失敗：${msg}`
    throw new Error(friendlyMessage)
  }
}

if (import.meta.env.DEV && !config) {
  console.warn(
    '[Firebase] 登入故障排查：1) .env 中 VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID 需與 Firebase 專案設定一致；2) 修改 .env 後須重啟 npm run dev；3) Console > Authentication > Sign-in method 啟用 Google；4) Authentication > Settings > Authorized domains 加入 localhost'
  )
}

/**
 * Debug 備案：若部署後仍 403，可在瀏覽器 Console 執行 __debugAppCheckGetToken()
 * 會呼叫 getToken(forceRefresh: true) 並印出成功／失敗與預覽（不輸出完整 token 以免外洩）
 */
if (typeof window !== 'undefined') {
  window.__debugAppCheckGetToken = async function () {
    if (!appCheckInstance || !appCheckEnabled) {
      console.warn('[Firebase] __debugAppCheckGetToken: App Check 未啟用，無 appCheckInstance')
      return null
    }
    try {
      const token = await getToken(appCheckInstance, true)
      const preview = token ? `${token.slice(0, 24)}... (長度 ${token.length})` : '(空)'
      console.log('[Firebase] getToken() 成功，預覽:', preview)
      return token
    } catch (err) {
      console.error('[Firebase] getToken() 失敗:', err?.message ?? err)
      throw err
    }
  }
}

export { auth, db, googleProvider }
export default app
