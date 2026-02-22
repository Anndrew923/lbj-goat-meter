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
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore'

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

    // App Check：必須在 db 請求前完成，僅正版 App 請求可進 Firestore
    // 開發環境可設 VITE_APP_CHECK_SKIP_IN_DEV=1 跳過初始化，避免 reCAPTCHA 在 localhost 產生 401（見下方註解）
    const skipAppCheckInDev =
      import.meta.env.DEV &&
      (import.meta.env.VITE_APP_CHECK_SKIP_IN_DEV === '1' ||
        import.meta.env.VITE_APP_CHECK_SKIP_IN_DEV === 'true')
    const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY ?? '').trim()
    if (typeof window !== 'undefined' && recaptchaSiteKey && !skipAppCheckInDev) {
      // --- Debug Token（嚴禁提交至正式環境）---
      // 以下僅供「開發環境」使用：讓本地可通過 App Check 而不依賴 reCAPTCHA 生產金鑰。
      // VITE_APP_CHECK_DEBUG_TOKEN 必須只存在於 .env.local，且 .env.local 不得提交版控；
      // 正式環境不得設定此變數，否則會繞過 App Check 驗證，造成安全風險。
      if (import.meta.env.DEV) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
      }
      const debugToken = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim()
      if (import.meta.env.DEV && debugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken
      }
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true, // 自動刷新，確保用戶長久在線時不會斷連
        })
        appCheckEnabled = true
      } catch (appCheckErr) {
        if (import.meta.env.DEV) {
          console.warn(
            '[Firebase] App Check 初始化失敗，寫入將被規則拒絕（403）：',
            appCheckErr?.message ?? appCheckErr
          )
        }
        // 不拋出：auth/db 照常初始化，僅寫入時會因規則觸發 403
      }
    }
    if (import.meta.env.DEV && skipAppCheckInDev) {
      console.info(
        '[Firebase] App Check 已在開發環境跳過（VITE_APP_CHECK_SKIP_IN_DEV），不會向 reCAPTCHA 發送請求；正式環境不受影響。'
      )
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

if (import.meta.env.DEV && !config) {
  console.warn(
    '[Firebase] 登入故障排查：1) .env 中 VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID 需與 Firebase 專案設定一致；2) 修改 .env 後須重啟 npm run dev；3) Console > Authentication > Sign-in method 啟用 Google；4) Authentication > Settings > Authorized domains 加入 localhost'
  )
}

export { auth, db, googleProvider }
export default app
