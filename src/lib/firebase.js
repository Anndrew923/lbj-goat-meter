/**
 * Firebase 核心配置 — 顯式初始化（Explicit Config）與 Singleton
 *
 * 設計意圖：
 * - 棄用 Firebase Hosting 的 /__/firebase/init.json 自動注入：該路徑僅在「已部署 Hosting 的
 *   firebaseapp.com」上存在，本地或自架網域會產生 404，且將配置綁在 Hosting 不利多環境與自架部署。
 * - 改由環境變數手動建構 firebaseConfig，利於 Staging/Prod 分離（.env.development / .env.production
 *   或 CI 注入），且敏感資訊僅存於 .env.local 或伺服器環境，不進版控。
 * - 單例：全域單一 App/Auth/Firestore，避免重複 initializeApp 與連線膨脹。
 *
 * 登入故障排查（Director's Note）：
 * - 環境變數：.env 的 VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID 需與 Firebase 專案設定完全一致；修改後須重啟 npm run dev。
 * - Sign-in method：Firebase Console > Authentication > Sign-in method，確認 Google 為「已啟用」。
 * - Authorized domains：Authentication > Settings > Authorized domains，加入本地網址（如 localhost）。
 *
 * 潛在影響：多專案（Multi-tenancy）時需改為 getApp(name) 或工廠模式；缺必要變數時不初始化，
 *           由呼叫端依 isFirebaseReady 決定是否使用 Auth/Firestore。
 */
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, enableIndexedDbPersistence } from 'firebase/firestore'

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
    auth = getAuth(app)
    // 《最強肉體》長輪詢配置：自動偵測長輪詢，減少 WebChannel 在開發環境的連線報錯
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    })
    // 緩存策略：優先讀取本地 IndexedDB，減少伺服器 Reads（尤其對不常變動的 profiles / warzoneStats）
    enableIndexedDbPersistence(db).catch((err) => {
      if (err?.code === 'failed-precondition') {
        if (import.meta.env.DEV) console.warn('[Firebase] 持久化：另一分頁已啟用，本分頁使用記憶體緩存')
      } else if (err?.code === 'unimplemented') {
        if (import.meta.env.DEV) console.warn('[Firebase] 持久化：此瀏覽器不支援 IndexedDB 離線持久化')
      } else if (import.meta.env.DEV) {
        console.warn('[Firebase] enableIndexedDbPersistence 失敗:', err?.message ?? err)
      }
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

if (import.meta.env.DEV && !config) {
  console.warn(
    '[Firebase] 登入故障排查：1) .env 中 VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID 需與 Firebase 專案設定一致；2) 修改 .env 後須重啟 npm run dev；3) Console > Authentication > Sign-in method 啟用 Google；4) Authentication > Settings > Authorized domains 加入 localhost'
  )
}

export { auth, db, googleProvider }
export default app
