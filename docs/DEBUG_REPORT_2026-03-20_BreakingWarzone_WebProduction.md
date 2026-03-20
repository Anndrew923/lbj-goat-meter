# 除錯報告：突發戰區（Breaking Warzone）Web Production

## 目的
在 2026/03/20 的「最後衝刺」階段，讓前端在 **Web production** 下可成功呼叫 `submitBreakingVote`，並確保失敗時回傳可讀的錯誤碼、避免無法診斷的 400/500。

## 測試環境
- 前端：`web production`（網頁實機測試，非 debug apk）
- 後端：Cloud Functions（1st gen）
- 變更目標：Golden Key（HMAC）+ Firestore Rules + reCAPTCHA 驗證 + 突發戰區 Transaction

## 症狀紀錄（依時間線）
1. 一開始突發戰區不可投票，出現 `signature mismatch`。
2. 接著出現部分請求失敗並出現 `500 Internal Server Error`（後端未封裝成 HttpsError 的 crash 路徑）。
3. 後續調整後仍無法投票，並遇到 reCAPTCHA 相關失敗：
   - `low-score-robot`（`recaptchaScore: null`）
   - 進一步回傳升級後可看到：`recaptchaErrorCode: invalid-input-response`

## 根因定位與修正（重點）
### A) Golden Key：突發戰區 payload 對齊問題（導致 signature-mismatch）
- 根因：後端 `verifyGoldenKey` 對 `submit_breaking_vote` 驗證的 `payloadForHash` 與前端 `createGoldenKeySignature` 使用的 payload 不一致（導致 `JSON.stringify(...)` 不同 → 永遠 mismatch）。
- 修正：
  - `functions/index.js` 的 `submitBreakingVote`：`verifyGoldenKey` 的 payload 僅保留與前端一致的欄位（`{ eventId, deviceId, optionIndex }`）。
  - `resetPosition` 的 payload 對齊（同類型風險，避免未來重置再踩錯）。

### B) Golden Key：避免簽章比對崩潰（500）
- 根因：原先 `timingSafeEqual` 在長度不一致時可能拋錯，外層沒有完全轉為 `HttpsError`，造成 500。
- 修正：
  - `verifyGoldenKey`：加入長度/hex 合法性檢查，錯誤統一以 `HttpsError("permission-denied", code="signature-mismatch")` 回傳，避免 crash。

### C) 突發戰區：`optionIndex` 型別不一致導致簽章不同
- 根因：前後端對 `optionIndex`（number vs string）處理規則不同，造成簽章 payload 序列化不一致。
- 修正：
  - 新增 `normalizeBreakingOptionIndex`，並在前端/後端使用一致規則。

### D) reCAPTCHA：先修復可診斷性，再定位 key/response 配對問題
1. 你在前端看到 `recaptchaScore: null`、code 為 `low-score-robot`。
2. 為了把「驗證失敗」的真正原因從 Google 回傳中顯示出來：
   - `functions/utils/verifyRecaptcha.js`：在失敗時把 Google 回傳的 `error-codes[0]` 額外回傳（`errorCodes`）。
   - `submitBreakingVote`：在回傳 `recaptcha-verify-failed` 時一起附帶：
     - `recaptchaErrorCode`（由 `error-codes[0]` 取）
     - `recaptchaError` / `recaptchaAction`（若存在）

3. 觀測到：`recaptchaErrorCode = invalid-input-response`
   - 意義：後端的 `RECAPTCHA_SECRET` 與前端送出的 token / 其驗證對應關係不匹配，或 token 對該 secret 無效/過期。

4. 進一步風險降低（常見環境變數貼上問題）：
   - `verifyRecaptcha.js`：對 `RECAPTCHA_SECRET` 做 `trim()`，避免環境變數尾端換行/不可見空白造成驗證失敗。

## 最終驗證結果
- 在修正後，`submitBreakingVote` 成功回傳：
  - `ok: true`
  - 並可觀察到 `vote_counts` / `total_votes` 有更新（前端顯示正常）。

## 影響範圍（本次除錯相關）
- Golden Key 簽章與驗證流程（`verifyGoldenKey` + `submitVote`/`submitBreakingVote`/`resetPosition`）
- 突發戰區 `optionIndex` 正規化
- reCAPTCHA 後端 secret 讀取與失敗回傳可診斷性（`recaptchaErrorCode`）
- 環境變數設定與更新（`RECAPTCHA_SECRET`、以及前端 `VITE_RECAPTCHA_SITE_KEY` 的部署一致性）

## 留存/後續建議
1. 強制在後端回傳 reCAPTCHA 的 `recaptchaErrorCode`（已做）並在 UI 顯示友善提示（避免使用者一直卡住）。
2. debug apk 測試前，建議先在 web production 做一次固定驗收（Golden Key + reCAPTCHA + Transaction）。
3. 若未來改用不同 reCAPTCHA/Enterprise，需同步更新 verify endpoint 與 token 來源，避免再現 `invalid-input-response`。

