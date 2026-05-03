/**
 * shared/admin.js — Firebase Admin SDK 初始化與 Firestore 核心物件
 *
 * 設計意圖：
 * - 所有 Feature 模組均從此處取得 db / FieldValue / Timestamp，而非各自呼叫 admin.initializeApp()。
 * - initializeApp 包覆 apps.length 防護，確保多模組 import 時不重複初始化。
 * - 將初始化隔離於此，方便測試時 mock 整個 shared/admin 模組，而不污染功能邏輯。
 */
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
export { admin };
