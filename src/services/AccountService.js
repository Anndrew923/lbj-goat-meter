/**
 * AccountService — 重新投票與帳號刪除的數據層
 *
 * 設計意圖：
 * - 所有涉及數據變動的操作均以 runTransaction 保證原子性，避免「只刪了 profile 卻沒刪 vote」等孤兒數據。
 * - 與業務 UI 解耦，便於單元測試與 Boss 在 DEV 模式下透過「數據清理清單」檢查資料庫。
 *
 * 潛在影響：若未來新增「立場全域計數」聚合文件（如 aggregates/votesByStance），
 *           需在本 Transaction 內同步遞減對應計數，以維持統計一致性。
 */

import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import app, { db, getFirebaseFunctions } from "../lib/firebase";

/**
 * 儲存 FCM Token 至 profile，供後端「戰況即時快報」推播鎖定發送對象。
 * 設計意圖：arrayUnion 避免同一設備多開分頁重複寫入造成陣列膨脹；lastActive 供後續清理過期 token 使用。
 * 呼叫端須確保 profiles/{uid} 已存在（例如僅在 hasProfile 為 true 時註冊推播），否則 updateDoc 會拋錯。
 *
 * @param {string} uid - Firebase Auth UID
 * @param {string} token - FCM device token
 */
export async function saveFCMToken(uid, token) {
  if (!uid || !token) return;
  const userRef = doc(db, "profiles", uid);
  await updateDoc(userRef, {
    fcmTokens: arrayUnion(token),
    lastActive: new Date(),
  });
}

/**
 * 帳號刪除 — Firestore 全域清理（不含 Auth）。
 * 防禦性重構：刪除帳號前必須在同一個 Transaction 內同步扣減 global_summary 與 warzoneStats，
 * 杜絕「刪帳號未扣票」導致用戶可循環開帳號灌票。扣票失敗則整筆 Transaction 回滾，帳號不刪。
 *
 * 禁止在 Transaction 內使用 query()。正確做法：Transaction 外 getDocs(query) 取得 docId 列表，
 * Transaction 內：階段一所有讀取（profile、global_summary、各 vote、各 global_events 突發話題）→
 * 階段二扣票寫入 → 突發戰區扣票與存證刪除 → 刪 votes → 刪 profile。
 *
 * @param {string} uid - 要刪除的用戶 UID
 * @returns {Promise<{ deletedProfile: boolean }>}
 */
export async function deleteAccountData(uid) {
  if (!uid) throw new Error("uid is required");
  const functions = getFirebaseFunctions();
  if (!functions) throw new Error("Firebase Functions not initialized");
  const deleteCallable = httpsCallable(functions, "deleteUserAccount");
  try {
    await deleteCallable();
    return { deletedProfile: true };
  } catch (err) {
    console.error("[AccountService] deleteUserAccount failed:", err);
    throw err;
  }
}
