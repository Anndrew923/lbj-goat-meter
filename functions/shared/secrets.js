/**
 * shared/secrets.js — Secret Manager 綁定宣告（集中化）
 *
 * 設計意圖：
 * - defineSecret 宣告集中於此，Feature 模組 import 宣告物件後傳入 onCall secrets 陣列，
 *   不在各功能檔案各自呼叫 defineSecret，避免同一 Secret 被重複定義。
 * - Secret 名稱字串與 GCP Secret Manager 中的鍵名嚴格一致；若需更名，只改此一處。
 * - 宣告與解析（.value()）刻意分離：宣告於此，解析在 secretResolver.js，
 *   讓測試可 mock resolver 而不需模擬 Secret Manager API。
 */
import { defineSecret } from "firebase-functions/params";

/** 設備指紋 HMAC pepper；submitVote 使用，用於 24h 同一戰區設備查重。 */
export const goatFingerprintPepperSecret = defineSecret("GOAT_FINGERPRINT_PEPPER");

/** Golden Key HMAC 驗證金鑰；submit_vote / submit_breaking_vote / reset_position 使用，防止未授權腳本濫發請求。 */
export const goatGoldenKeySecret = defineSecret("GOAT_GOLDEN_KEY_SECRET");

/** 廣告獎勵 Token 簽章金鑰；issueAdRewardToken 簽發、resetPosition 驗證。 */
export const adRewardSigningSecret = defineSecret("AD_REWARD_SIGNING_SECRET");

/** reCAPTCHA v3 後端 Secret Key；submitVote / submitBreakingVote 使用，向 Google API 驗證前端 token。 */
export const recaptchaSecretParam = defineSecret("RECAPTCHA_SECRET");
