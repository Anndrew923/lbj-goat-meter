# Netlify 環境變數檢查清單

專案實際使用到的 `VITE_*` 環境變數與 Netlify 建議對照。

---

## 必要（缺一會影響功能）

| 變數名稱 | 用途 | 你目前有？ |
|----------|------|------------|
| `VITE_FIREBASE_API_KEY` | Firebase 設定 | ✅ 有 |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase 設定 | ✅ 有 |
| `VITE_FIREBASE_PROJECT_ID` | Firebase 設定 | ✅ 有 |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase 設定 | ✅ 有 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase 設定 | ✅ 有 |
| `VITE_FIREBASE_APP_ID` | Firebase 設定 | ✅ 有 |
| **`VITE_APP_CHECK_SITE_KEY`** | **App Check（reCAPTCHA Enterprise 網站金鑰）** | ⚠️ **若沒有請補上** |
| `VITE_RECAPTCHA_SITE_KEY` | 投票／重置時 reCAPTCHA v3 token（後端驗證用） | ✅ 有 |

---

## 建議補上

| 變數名稱 | 用途 | 備註 |
|----------|------|------|
| **`VITE_APP_CHECK_SITE_KEY`** | Firebase App Check 用 reCAPTCHA Enterprise **網站金鑰** | 與 `VITE_RECAPTCHA_SITE_KEY` **不同**：前者給 App Check，後者給 Cloud Functions 驗證。缺了 App Check 不會初始化；填錯會 400。請從 Firebase Console → App Check → reCAPTCHA Enterprise 複製「網站金鑰」貼上。 |
| `VITE_GOOGLE_WEB_CLIENT_ID` | 原生 App（Capacitor Android/iOS）Google 登入 | 僅發佈 Android/iOS 時需要；純 Web 可略。 |

---

## 選填（廣告／進階）

| 變數名稱 | 用途 |
|----------|------|
| `VITE_ADMOB_INTERSTITIAL_ID` | 插頁廣告單元 ID |
| `VITE_ADMOB_REWARDED_VIDEO_ID` | 獎勵廣告單元 ID（重置立場） |
| `VITE_ADMOB_USE_TEST_IDS` | 是否使用 Google 測試廣告（true/false） |
| `VITE_ADMOB_TEST_DEVICE_IDS` | 測試裝置 ID（逗號分隔） |

---

## 總結：請確認 Netlify 有這一個

- **`VITE_APP_CHECK_SITE_KEY`**  
  若畫面上沒有這筆，請在 Netlify 新增，值為 **Firebase Console → App Check → reCAPTCHA Enterprise 的「網站金鑰」**（與 GCP 金鑰 ID 一致，例如 `6LdOnYQSAAAAA...`）。  
  儲存後執行 **Clear cache and deploy**。
