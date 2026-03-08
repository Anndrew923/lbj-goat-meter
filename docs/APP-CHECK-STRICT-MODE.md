# App Check 嚴謹模式 — 設定檢查清單

本專案在**嚴謹規則**下要求所有寫入（投票、Profile、device_locks、warzoneStats）皆通過 **App Check**，僅允許帶有有效 reCAPTCHA v3 token 的請求，以抵禦腳本與未授權客戶端。

---

## 1. Firestore 規則（已啟用嚴謹模式）

- `firestore.rules` 中 `hasValidAppCheck()` 為：
  - `return request.appContext.appCheck != null;`
- 部署規則：`firebase deploy --only firestore:rules`

---

## 2. reCAPTCHA 金鑰與網域（必要）

### 2.1 reCAPTCHA Admin（網站金鑰）

1. 前往 [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin)
2. 使用與 Firebase 專案相同的 Google 帳號
3. 找到對應的 **reCAPTCHA v3** 網站金鑰（Site Key，例如 `6Lfes...`）
4. **網域 (Domains)** 必須包含：
   - Production：`lbj-goat-meter.netlify.app`（或你的正式網域）
   - 開發：`localhost`（可選）
5. 確認金鑰類型為 **reCAPTCHA v3**、用途為 **Web**

### 2.2 Firebase Console — App Check

1. [Firebase Console](https://console.firebase.google.com/) → 專案 → **App Check**
2. 在 **Web** 應用程式中，確認已註冊 **reCAPTCHA v3** 提供者
3. **reCAPTCHA v3 金鑰**：Site Key 與上方一致；**Secret Key** 需從 reCAPTCHA Admin 複製並貼到 Firebase（僅存於 Firebase，勿寫入前端環境變數或版控）

---

## 3. 環境變數

- **Production（Netlify）**：`VITE_APP_CHECK_SITE_KEY` = 上述 reCAPTCHA v3 的 **Site Key**（6Lfes...）
- 建置時會被打進 bundle；部署後請執行 **Clear cache and deploy** 以確保使用最新 key

---

## 4. Referer 政策（讓 reCAPTCHA 能驗證來源）

reCAPTCHA 依 **Referer** 驗證請求是否來自允許的網域；若 Referer 被擋或為空，會回 401，導致無法取得 App Check token、進而 Firestore 403。

本專案已設定：

- **Netlify**（`netlify.toml`）：全站 `Referrer-Policy: no-referrer-when-downgrade`，對 HTTPS 跨站（如 google.com）送出來源
- **HTML**（`index.html`）：`<meta name="referrer" content="no-referrer-when-downgrade" />`

請勿改為 `no-referrer` 或過於嚴格的 policy，否則 reCAPTCHA 可能無法取得 token。

---

## 5. 投票流程中的 App Check

- 投票前會呼叫 `ensureFreshAppCheckToken()`（`getToken(forceRefresh: true)`），確保帶入最新 token
- 若第一次 Commit 因 403 失敗，會自動**重試一次**（先刷新 token 再送 Transaction），以應對 token 即將過期的邊界情況

---

## 6. 故障排查

| 現象 | 可能原因 | 建議動作 |
|------|----------|----------|
| Console 出現 reCAPTCHA `api2/pat` **401** | PAT 流程的預期行為，或 Referer 未送出 | 確認 Netlify 與 meta referrer 已設定；若**投票可成功**則可忽略此 401 |
| 投票時 **403 permission-denied** | App Check token 無效或未帶上 | 檢查 reCAPTCHA 網域、Firebase App Check Secret、Referrer-Policy；重新登入後再試 |
| 開發環境 403 | 未設定 Debug Token 或 reCAPTCHA 未允許 localhost | Firebase Console > App Check > 管理偵錯權杖；或 `.env.local` 設 `VITE_APP_CHECK_SKIP_IN_DEV=1`（僅開發用） |

---

## 7. 總結

嚴謹模式下要能正常投票，需同時滿足：

1. **Firestore 規則**已部署且 `hasValidAppCheck()` 為 `request.appContext.appCheck != null`
2. **reCAPTCHA Admin** 網域包含正式站網址
3. **Firebase App Check** 的 reCAPTCHA v3 的 Site Key / Secret Key 正確
4. **Netlify 環境變數** `VITE_APP_CHECK_SITE_KEY` 為該 Site Key，並 Clear cache and deploy
5. **Referrer-Policy** 允許對 Google 送出來源（已由 netlify.toml + index.html 設定）

以上皆正確後，在嚴謹規則下即可正常投票，並有效防護腳本攻擊。
