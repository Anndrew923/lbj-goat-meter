# 改用 reCAPTCHA Enterprise（解決 401/403）

## 為什麼改「不限制金鑰」沒用？

你改的是 **Google Cloud 的「Browser key (auto created by Firebase)”**，也就是 **Firebase Web API Key**（client 打 Firestore / Auth 用的那一支）。  
401 發生在 **Firebase 後端向 Google 驗證 reCAPTCHA token** 的時候，用的是 **Firebase App Check 裡填的 reCAPTCHA 密鑰**，不是這支 Browser key，所以改這支的「不限制金鑰」不會影響 401。

---

## 你的金鑰是 Enterprise，程式卻是標準 v3

你畫面上的金鑰（GOAT-V3-PURE-STABLE、總覽／整合／前端後端）是 **reCAPTCHA Enterprise**（在 Cloud Console 建立）。  
我們程式目前用的是 **ReCaptchaV3Provider**，只吃 **標準 reCAPTCHA v3**（在 google.com/recaptcha/admin 建立）。  
金鑰是 Enterprise、驗證走標準 v3 → 就會 401。解法是**改用 reCAPTCHA Enterprise**。

---

## 已做的程式改動

程式已支援依環境變數切換：

- **`VITE_APP_CHECK_USE_ENTERPRISE`** 設為 `true` 或 `1` → 使用 **ReCaptchaEnterpriseProvider**（吃你現在的 Enterprise 金鑰）。
- 未設 → 維持 **ReCaptchaV3Provider**（標準 v3）。

---

## 你要做的設定（依序）

### 1. Firebase App Check 改成「reCAPTCHA Enterprise」

- [Firebase Console](https://console.firebase.google.com/) → 專案 → **App Check**
- 點你的 **Web 應用程式**（lbj-goat-meter-web）
- 若目前是「reCAPTCHA v3」：
  - 改為使用 **reCAPTCHA Enterprise** 提供者（若有「新增提供者」或「編輯」可選 Enterprise，就選那個）。
  - 貼上你 **同一個** Enterprise 金鑰的 **Site Key**（就是現在 Netlify 用的 `6Lfes...` 那組）。
- 若畫面上沒有「reCAPTCHA Enterprise」選項，先到 **Google Cloud Console** → **reCAPTCHA Enterprise** 確認該專案已啟用 reCAPTCHA Enterprise API，再回 Firebase App Check 看是否出現 Enterprise 選項。  
- 儲存。

### 2. Netlify 環境變數

- 在 Netlify 的 Environment variables 新增（或修改）：
  - **Key**: `VITE_APP_CHECK_USE_ENTERPRISE`
  - **Value**: `true`
- `VITE_APP_CHECK_SITE_KEY` 維持你現在的 **Enterprise Site Key**（不變）。
- 儲存後執行 **Clear cache and deploy**。

### 3. 確認 reCAPTCHA Enterprise API

- [Google Cloud Console](https://console.cloud.google.com/) → 選 **與 Firebase 同一個專案**
- **API 與服務** → **程式庫** → 搜尋 **reCAPTCHA Enterprise**
- 若未啟用，請**啟用**。

### 4. 再試一次投票

部署完成後，到 Production 站試投票。Console 應會出現 `[Firebase] App Check 已啟用（reCAPTCHA Enterprise）`。若仍 401/403，再檢查 Firebase App Check 是否已選「reCAPTCHA Enterprise」並存檔。

---

## 總結

- **Browser key「不限制」**：無關 401，可保留。
- **金鑰是 Enterprise**：必須用 **ReCaptchaEnterpriseProvider** + Firebase App Check 選 **reCAPTCHA Enterprise**。
- **程式**：已支援 `VITE_APP_CHECK_USE_ENTERPRISE=true` 切到 Enterprise；Netlify 設好並 Clear cache and deploy 即可。
