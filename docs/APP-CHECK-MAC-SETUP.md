# App Check 401 與簽名對齊 — macOS 本地開發檢查清單

---

## 0. 403 診斷流程（Firestore 規則攔阻時）

若寫入 Firestore 出現 **403**，依下列步驟判斷是 App Check 還是業務邏輯問題。

### 1. 臨時規則降級（Diagnostic Mode）

在 **Firestore Rules** 中暫時將 `hasValidAppCheck()` 改為 `return true;`（專案內 `firestore.rules` 已提供註解區塊，可切換）。

- **若這樣能動**：代表 App Check 的 Secret Key 沒在 Firebase 存好，或權杖尚未生效 → 執行下方「2. 儲存 Secret Key」與「3. 強制刷新權杖」。
- **若這樣還是 403**：代表是 `isValidVote()` 或其它業務邏輯判斷有誤（例如 `starId`、`status` 白名單、`userId` 與 `request.auth.uid` 不一致）。診斷完成後請將規則還原為 `return request.appContext.appCheck != null;`。

### 2. 儲存 Secret Key

請確認 **Firebase Console → App Check → reCAPTCHA v3 提供者 → 密鑰** 已填入與 reCAPTCHA Console 一致的 **Secret Key**（非 Site Key）。  
若使用下列金鑰，請於上述位置貼上並儲存（此金鑰僅存於 Firebase 後台，勿寫入前端 .env 或版控）：

```
6LfesYMsAAAAAJv10s6Lo5t8zouut-_THluBDucm
```

### 3. 強制刷新權杖

客戶端已在交易邏輯前呼叫 `ensureFreshAppCheckToken()`，內部使用 `getToken(appCheckInstance, true)`（`forceRefresh: true`），確保不使用舊快取權杖。若仍 403，請確認 App Check 已成功初始化（Console 無相關錯誤）、且 Secret Key 已正確填入 Firebase。

---

## 1. Android Debug 指紋（Mac 本機 keystore）

環境遷移至 macOS 後，請將**本機 debug 指紋**同步至 Firebase Console，否則 Android 建置會因簽名不符被拒。

### 取得指紋

```bash
cd android && ./gradlew signingReport
```

在輸出中找到 **Variant: debug**（:app），複製 **SHA-1** 與 **SHA-256** 至 Firebase。

> **機器差異**：下表為「本機首次建立 debug.keystore」時產生的範例。若你在不同機器或曾重新產生 keystore，請以該次 `signingReport` 輸出為準並同步更新 Firebase Console。
>
> | 類型       | 範例值（僅供參考） |
> |------------|--------------------|
> | **SHA-1**   | `7D:94:C0:AB:65:80:83:EA:44:C0:05:12:A0:19:1D:BC:17:31:FE:59` |
> | **SHA-256** | `F2:A3:E2:6A:9D:EF:F7:59:81:97:C1:E8:19:9D:99:4C:65:F9:5A:FA:08:64:34:31:E3:23:44:8D:1B:26:2C:D0` |

### 同步至 Firebase

- Firebase Console → 專案設定 → 您的應用程式 → 選 Android App
- 新增/編輯「SHA 憑證指紋」，貼上上述 **SHA-1** 與 **SHA-256**

> 若曾出現 `Missing keystore`，本專案已於 `~/.android/debug.keystore` 建立預設 debug keystore，可直接再跑一次 `signingReport` 取得指紋。

---

## 2. reCAPTCHA 401 Unauthorized

### 後台檢查（Google Cloud Console）

- **reCAPTCHA Enterprise**：確認專案已啟用 reCAPTCHA（v3 / Enterprise）。
- **授權網域**：在 reCAPTCHA 金鑰設定中，將以下網域加入「授權網域」：
  - `localhost`
  - 目前正式/預覽用的 Web 網域（例如 `yourapp.netlify.app` 或自訂網域）

### 金鑰與 .env 一致

- `.env` 或 `.env.local` 中的 **`VITE_APP_CHECK_SITE_KEY`** 必須與 Google Cloud Console / Firebase App Check 註冊的 reCAPTCHA v3 **網站金鑰**完全一致。
- 修改後請重啟 `npm run dev`。

### 100% 嚴謹模式：Web 端密鑰對齊（Site Key + Secret Key）

啟用嚴謹規則前請確保兩邊 100% 對齊，避免 App Check 驗證失敗（403）：

1. **reCAPTCHA Console**：複製 **Secret Key**（非 Site Key；用於後端驗證）。
2. **Firebase Console → App Check**：在 reCAPTCHA v3 提供者設定中，將「密鑰」欄位重填為上述 **Secret Key**，與 reCAPTCHA Console 完全一致。
3. **Site Key** 維持在客戶端（`.env.production` / Netlify 的 `VITE_APP_CHECK_SITE_KEY`）；Secret Key 僅存於 Firebase 後端，勿寫入前端環境變數。

---

## 3. 強制開啟本地 Debug Token（Mac 版）

程式已在本機開發時於 `src/lib/firebase.js` 開頭設定：

```js
if (typeof self !== 'undefined' && import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
}
```

### 操作步驟

1. 啟動 `npm run dev`。
2. 開啟瀏覽器開發者工具 → Console。
3. 找到並複製 **「Firebase App Check debug token」** 字串。
4. 貼回 **Firebase Console → App Check → 應用程式 → 管理偵錯權杖** 並儲存。

若已在 `.env.local` 設定 `VITE_APP_CHECK_DEBUG_TOKEN=<上述 token>`，下次載入會直接使用該 token 通過驗證。

### Android 偵錯版 APK 與 Logcat 取得 Debug Token

本專案為 **Capacitor（WebView）**，App Check 使用 **JavaScript SDK**，權杖由 WebView 內 Console 輸出；可能經由 Chromium 轉發至 logcat，或需用 Chrome 遠端除錯取得。

1. **設定 Android SDK**：在專案根目錄或本機建立 `android/local.properties`，設定 `sdk.dir`（例如 `sdk.dir=/Users/你的用戶名/Library/Android/sdk`），或設定環境變數 `ANDROID_HOME`。
2. **產出偵錯 APK**：
   ```bash
   cd android && ./gradlew assembleDebug
   ```
   產出路徑：`android/app/build/outputs/apk/debug/app-debug.apk`。
3. **安裝並啟動偵錯版** 後，Firebase App Check 會因 `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`（`src/lib/firebase.js` 在 DEV 時設定）噴出 Debug Token。
4. **從 Logcat 抓取權杖**：
   - **先執行**下列指令（會持續輸出），**再重啟 App**，觀察是否出現權杖：
   ```bash
   adb logcat -c && adb logcat | grep -Ei "AppCheck|debug\.?token|FirebaseAppCheck|Enter this debug|allow list|safelist|DebugAppCheckProvider"
   ```
   - JS SDK 常見 log 內容：`AppCheck debug token: "UUID". You will need to safelist it...`
   - 若 logcat 無輸出：用 **Chrome 遠端除錯** — 手機接 USB、Chrome 開啟 `chrome://inspect` → 點選本 App 的 WebView → 在 DevTools Console 中搜尋 `AppCheck debug token` 或 `safelist`，複製 UUID。
   - 將取得的 **UUID** 貼至 Firebase Console > App Check > 應用程式 > 管理偵錯權杖。

---

## 4. 環境變數鎖定（開發測試）

在 **`.env.local`** 中確保有以下 flag，方便本地跳過 reCAPTCHA 請求、避免 401：

```env
VITE_APP_CHECK_SKIP_IN_DEV=true
```

- 設為 `true` 或 `1` 時，開發環境會跳過 App Check 初始化，不會向 reCAPTCHA 發送請求。
- 正式環境不會讀取此變數，不影響上線安全。

可參考 `.env.local.example` 複製為 `.env.local` 並依需調整。

---

## 5. 數據預聚合（analytics_pro）驗證

規則修復後，投票觸發的 `persistAnalyticsPro` 應在 **`analytics_pro`** 集合正確寫入快照：

- **文件 ID**：與查詢的 **CacheKey** 一致（由 `buildCacheKey(starId, filters)` 產生）。
- **欄位**：`starId`, `summary`, `breakdown`, `filters`, `generatedAt`, `ownerUid`（符合 `firestore.rules` 的 `isValidAnalyticsProDoc()` 白名單）。

驗證方式：在 Firestore Console 開啟 `analytics_pro`，執行一次投票或進入會觸發 `useSentimentData` 的畫面，確認會新增/更新以 CacheKey 為 ID 的文件。
