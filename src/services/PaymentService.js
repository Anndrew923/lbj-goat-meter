/**
 * PaymentService — 金流沙盒與未來 RevenueCat 對接預留
 *
 * 設計意圖：
 * - 沙盒：simulatePurchase() 模擬「支付處理中」→ 以 Transaction 更新 Firestore profiles.isPremium。
 * - 正式對接：RevenueCat 在用戶完成訂閱後會向我們的後端發送 Webhook；後端應驗證簽名後，
 *   以 Admin SDK 寫入 profiles/{userId}.isPremium = true（或更新 entitlements 集合）。
 *   客戶端不應直接信任「前端點擊」即開通，應以 Webhook 回寫為單一真相來源；本模組的
 *   simulatePurchase 僅用於開發／展示，等同「模擬 Webhook 已送達」的結果。
 *
 * RevenueCat Webhook 對接要點（未來實作）：
 * - 訂閱事件 (SUBSCRIBER_ALIAS) 或 RENEWAL 時，從 payload 取得 app_user_id（即我們的 userId）。
 * - 驗證 Webhook 簽名 (X-RevenueCat-Signature)。
 * - Cloud Function 或後端 API 執行：firestore().doc(`profiles/${userId}`).set({ isPremium: true }, { merge: true })。
 * - 客戶端透過 AuthContext 的 refreshEntitlements() 或即時監聽 profiles 取得最新 isPremium。
 */
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

const SIMULATE_DURATION_MS = 2000

/**
 * 模擬購買分析師通行證：顯示延遲後以 Transaction 更新 profiles.isPremium。
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<void>}
 */
export async function simulatePurchase(userId) {
  if (!userId) throw new Error('userId is required')

  await new Promise((resolve) => setTimeout(resolve, SIMULATE_DURATION_MS))

  const profileRef = doc(db, 'profiles', userId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(profileRef)
    if (!snap.exists()) throw new Error('Profile not found')
    tx.update(profileRef, {
      isPremium: true,
      updatedAt: serverTimestamp(),
    })
  })
}
