# reCAPTCHA 400 Bad Request：別把「密鑰」當「網站金鑰」用

當 Console 出現：

- `POST https://www.google.com/recaptcha/api2/clr?k=6LfesYMsAAAAA...` → **400 (Bad Request)**
- `AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)`

且你的 key 是 **40 字元、以 6L 開頭**，很可能是：**前端用了「密鑰」(Secret Key)，而不是「網站金鑰」(Site Key)**。

---

## 兩支 key 的差別

| 名稱 | 用途 | 填在哪裡 | 範例中段（僅供辨識） |
|------|------|----------|----------------------|
| **網站金鑰 (Site Key)** | 給瀏覽器／前端用 | **Netlify** `VITE_APP_CHECK_SITE_KEY`、前端程式 | 中段常含 `Jeldp8...`、結尾常似 `...DQb90` |
| **密鑰 (Secret Key)** | 給後端驗證用 | **Firebase Console** App Check 的「reCAPTCHA 密鑰」 | 中段常含 `Jv10s6...`、結尾常似 `...THluBDucm` |

- 若請求網址裡的 `k=` 是 **`...Jv10s6Lo5t8zouut-_THIuBDucm`** 或 **`...THluBDucm`**，那是**密鑰的格式**。
- 前端必須用 **網站金鑰**，長相會不同（例如中段是 `Jeldp8...`、結尾是 `...DQb90`）。

---

## 正確做法

1. 打開 **reCAPTCHA Admin**，進入你用的那組 reCAPTCHA v3 金鑰。
2. 在該頁找到 **「網站金鑰」**（說明會寫：用於 HTML／用戶端），點 **「複製網站金鑰」**。
3. **不要**複製「密鑰」或「複製密鑰」。
4. 到 **Netlify** → 環境變數 → **`VITE_APP_CHECK_SITE_KEY`** → 貼上**剛複製的網站金鑰**（整段替換）。
5. 儲存後執行 **Clear cache and deploy**。
6. 再試投票；請求網址裡的 `k=` 應變成另一串（網站金鑰），400 才會消失。

---

## 如何確認沒搞混

- **Firebase App Check** 裡「reCAPTCHA 密鑰」欄位 = 只填 **密鑰**（從 reCAPTCHA Admin「複製密鑰」）。
- **Netlify** `VITE_APP_CHECK_SITE_KEY` = 只填 **網站金鑰**（從 reCAPTCHA Admin「複製網站金鑰」）。

兩支 key 長度都約 40、都 6L 開頭，但**內容不同**；填反或貼錯會導致 400 與 `appCheck/recaptcha-error`。

---

## 生產環境一開頁就 400（已確認是網站金鑰）

若 Netlify 已填**網站金鑰**、一打開生產網址仍出現 400 與 `AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)`，多半是 **目前網域未加入 reCAPTCHA 金鑰的允許清單**。

### 本專案使用 reCAPTCHA Enterprise

- 金鑰在 **Google Cloud Console** → **Security** → **reCAPTCHA Enterprise**。
- 進入你給 App Check 用的那支 **Key** → **設定**（或 Web 設定）→ **網域**。
- 在 **「已授權的網域」** 中新增：
  - 你的 **Netlify 網址**（例如 `https://你的站名.netlify.app` 或 `https://你的自訂網域.com`）。
  - 只填網域即可，例如 `你的站名.netlify.app` 或 `你的自訂網域.com`（依 Console 欄位說明為準）。
- 儲存後等幾分鐘再重新整理生產站，400 應會消失。

### 檢查清單（生產 400）

| 項目 | 說明 |
|------|------|
| 前端 key | Netlify `VITE_APP_CHECK_SITE_KEY` = reCAPTCHA **Enterprise 網站金鑰**（非密鑰）。 |
| 網域授權 | reCAPTCHA Enterprise 金鑰的「已授權的網域」須包含生產網域（Netlify 或自訂網域）。 |
| Provider 一致 | Firebase Console App Check 為 **reCAPTCHA Enterprise**，程式使用 `ReCaptchaEnterpriseProvider`（本專案已採用）。 |

---

## 金鑰是企業版還是標準版？程式有對接對嗎？

### 如何判斷金鑰種類

| 金鑰建立位置 | 種類 | 程式應用的 Provider |
|--------------|------|---------------------|
| **Google Cloud Console** → Security → **reCAPTCHA**（你現在的畫面） | **reCAPTCHA Enterprise** | `ReCaptchaEnterpriseProvider` ✅ |
| google.com/recaptcha/admin（舊版 reCAPTCHA 後台） | 標準 reCAPTCHA v3 | `ReCaptchaV3Provider` |

你的金鑰 **GOAT-Meter-0309** 是在 **GCP reCAPTCHA** 裡、類型為 **Website • Score**，屬於 **reCAPTCHA Enterprise**。「Website • Score」只代表「網站用、分數型」，不影響它是 Enterprise。

### 本專案程式碼對接狀況

- 程式使用：`ReCaptchaEnterpriseProvider(siteKey)`，讀取 `VITE_APP_CHECK_SITE_KEY`。
- 與 GCP 的 **Enterprise 網站金鑰**（畫面上的 **ID**：`6LdOnYQSAAAAA...`）對接方式正確。

### 若網域已加仍 400：請查 Firebase Console

400 常來自 **Firebase App Check 的提供者與金鑰不一致**：

1. 打開 **Firebase Console** → 專案 **lbj-goat-meter** → **App Check**。
2. 在 **應用程式** 清單找到你的 **Web 應用程式**（appId 對應的那個）。
3. 點進該應用程式，看 **提供者** 欄位：
   - 必須是 **「reCAPTCHA Enterprise」**（不是「reCAPTCHA v3」）。
   - 若目前是「reCAPTCHA v3」，請改為 **「reCAPTCHA Enterprise」**，並填上同一個金鑰的 **Site Key**（ID）與 **Secret Key**（在 GCP 該金鑰編輯頁可複製）。
4. 儲存後重新整理生產站再測。

Firebase 端若選成「reCAPTCHA v3」，會預期標準 v3 的 token 格式；你前端送的是 Enterprise token，就會出現 400。

---

## 其他可能原因（網域、Firebase、權杖存留時間都設好仍 400）

若 **網域清單**、**Firebase App Check 提供者**、**權杖存留時間** 都確認無誤，仍出現 400，可依序檢查：

### 1. Site Key 是否一字不差

`VITE_APP_CHECK_SITE_KEY` 是在 **建置時** 寫進前端的，任一字元錯誤（例如 **0 與 O**、**小寫 s 與大寫 S**）都會讓 Google 回 400。

- 到 **Firebase Console** → App Check → 你的 Web 應用程式 → reCAPTCHA Enterprise 設定，**複製「網站金鑰」**（不要手打）。
- 到 **Netlify** → 環境變數 → `VITE_APP_CHECK_SITE_KEY` → **貼上**（整段替換），儲存。
- 執行 **Clear cache and deploy**，再開生產站測試。
- 可在生產站 Console 看 `[Firebase] App Check Site Key 前綴:` 的 log（若專案有加診斷），比對前幾碼是否與 Firebase 顯示一致。

### 2. reCAPTCHA Enterprise API 是否已啟用

- **Google Cloud Console** → 專案 **lbj-goat-meter** → **API 與服務** → **已啟用的 API**。
- 確認有 **「reCAPTCHA Enterprise API」**；若沒有，搜尋並啟用後再試。

### 3. 建置有帶到最新 key（Clear cache and deploy）

- 環境變數改動後，Netlify 必須 **Clear cache and deploy**，否則舊 key 仍會被打進 bundle，可能導致 400。

### 4. Referrer／瀏覽器環境

- 若使用 **no-referrer** 或嚴格隱私擴充，可能讓請求不帶 Referer，Google 可能拒絕對應請求。
- 建議用 **無痕視窗** 或關閉擋廣告／隱私擴充再測一次；本專案 `index.html` 已設 `no-referrer-when-downgrade`，一般情況下會帶 Referer。

### 5. 仍無法排除時

- 在 **GCP reCAPTCHA Enterprise** 建立一支**新的** Website • Score 金鑰，網域與 Firebase App Check 都設好，Netlify 改為新 key 並 Clear cache and deploy 再測，可排除「單一金鑰異常」。
