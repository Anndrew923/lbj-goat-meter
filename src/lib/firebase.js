/**
 * Firebase 核心配置 — Singleton 模式
 *
 * 設計意圖：
 * - 確保全域只有一個 Firebase App / Auth / Firestore 實例，降低內存佔用與連線數。
 * - 避免在多處 initializeApp 導致 "Firebase: Firebase App named '[DEFAULT]' already exists" 錯誤。
 * - 便於測試時可替換為 Mock 實例（依賴注入點單一）。
 *
 * 潛在影響：若未來需多專案（Multi-tenancy）需改為 getApp(name) 或工廠模式。
 */
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// 開發環境：若未設定關鍵變數則提早警告，避免執行時出現 auth/configuration-not-found
const required = ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN']
const missing = required.filter((key) => !import.meta.env[key]?.trim())
if (import.meta.env.DEV && missing.length) {
  console.warn(
    '[Firebase] 缺少環境變數:',
    missing.join(', '),
    '— 請複製 .env.example 為 .env 並填入 Firebase 專案設定；若已填入仍出現 configuration-not-found，請到主控台啟用 Authentication。'
  )
}

// 單例：僅在未初始化時建立 App，否則重複 import 不會重複建立
const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
