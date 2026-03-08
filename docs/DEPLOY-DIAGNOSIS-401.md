# 深度診斷報告：投票 401 與 App Check / reCAPTCHA

**診斷時間**：依執行當下  
**目的**：釐清 Production 投票請求 401 原因（排除 Google 控制台設定後之代碼與部署面檢查）

---

## ⚠️ 重要結論：`api2/pat` 的 401 是「預期行為」，無須消滅

若 Console 中紅字 401 的請求網址是：

`https://www.google.com/recaptcha/api2/pat?k=...`

根據 **Google 官方文件** [Understand how reCAPTCHA uses Private Access Tokens](https://cloud.google.com/recaptcha/docs/private-access-tokens)：

- 這是 **Private Access Token (PAT)** 協定的一環：reCAPTCHA 會先對 `/pat` 發一次請求，**刻意回 401**，並在 Response 帶特殊 header，用來偵測裝置是否能產生 PAT（例如部分 iOS/macOS）。
- **此 401 不會導致 reCAPTCHA 失效**，之後點擊或執行 `execute` 時，reCAPTCHA 仍會產出有效 token。
- 在 Chrome 的 **Device Toolbar（模擬手機）** 或部分 Safari / iOS 情境下，這個 401 更容易出現在 Console，屬已知現象（[google/recaptcha#561](https://github.com/google/recaptcha/issues/561)）。

**因此：若「投票本身有成功寫入」、僅 Console 出現此 401，可視為正常，無須再從程式或後台「消滅」它。**

若投票仍失敗（例如 Firestore 回 403），則需針對 **Firestore / App Check 的請求** 排查，而非此 `/pat` 請求。

---

## 1. Response Body（需 Boss 手動提供）

**本項無法由自動化執行**：請在瀏覽器完成以下步驟後，將內容貼回或截圖給工程師。

1. 打開 **https://lbj-goat-meter.netlify.app/**（或實際 Production 網址）
2. 開 **DevTools** → **Network** 標籤
3. 勾選 **Preserve log**（可選，方便重現）
4. 執行一次投票，找到 **紅色 401** 的請求（多半為 `firestore.googleapis.com` 或 reCAPTCHA / App Check 相關網域）
5. 點擊該請求 → 切到 **Response** 子標籤
6. **複製 Response 內全部 JSON 文字** 或截圖，提供給布魯斯

常見 401 Response 會包含：
- `error.code`（如 `UNAUTHENTICATED`、`PERMISSION_DENIED`）
- `message`（錯誤描述，可能提到 App Check、reCAPTCHA、invalid token 等）

**請將上述 Response 內容貼上，以便對應到下一階段的修正。**

---

## 2. Provider 核對結果：✅ 未使用 ReCaptchaEnterpriseProvider

**已執行**：全專案搜尋 `ReCaptchaEnterpriseProvider`、`ReCaptchaEnterprise`。

**結果**：**無任何使用。**

- App Check 僅使用 **`ReCaptchaV3Provider`**（`src/lib/firebase.js`）。
- 與 Firebase App Check 的 reCAPTCHA v3 設定一致，無 Enterprise / 雙 Provider 混用問題。

```28:28:src/lib/firebase.js
import { getToken, initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
```

```109:111:src/lib/firebase.js
        appCheckInstance = initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
```

---

## 3. 強制重排快取（Clear cache and deploy）

**本項需在 Netlify 後台手動執行**：

1. 登入 **Netlify** → 選擇 **lbj-goat-meter** 站點
2. **Site configuration** → **Build & deploy** → **Build settings**
3. 在 **Deploys** 頁籤中，點 **Trigger deploy** → 選擇 **Clear cache and deploy site**
4. 等待 build 完成（會重新執行 `npm run build`，並使用**當時**的環境變數）

**重要**：請同時確認 **Environment variables** 中  
**`VITE_APP_CHECK_SITE_KEY`** 已設為 **新 Site Key（6Lfes... 開頭）**。  
若未設定，Build 會使用 repo 內 `.env.production` 的值；目前 repo 內該檔仍為 **6Lepo...** 舊 key，可能導致 401。  
→ **建議**：在 Netlify 後台明確設定 `VITE_APP_CHECK_SITE_KEY` = 新 key（6Lfes...），再執行 **Clear cache and deploy**。

---

## 4. Referer 驗證

**代碼面**：專案中**沒有任何一處**設定或改寫 `Referer` header；由瀏覽器依當前頁面網址自動帶上。

**Production 預期**：  
從 **https://lbj-goat-meter.netlify.app/** 發出的請求，`Referer` 應為  
`https://lbj-goat-meter.netlify.app/` 或同源路徑（例如 `https://lbj-goat-meter.netlify.app/arena`）。

**請 Boss 手動確認**：
1. Network 中點選該 **401 請求**
2. 在 **Headers** 區塊找到 **Request Headers**
3. 查看 **Referer** 是否為 `https://lbj-goat-meter.netlify.app/`（或同源）

若 Referer 為空、或為其他網域（例如 localhost、其他 Netlify 預覽網址），reCAPTCHA v3 可能因網域不允許而回 401。  
此時需在 **Google Cloud Console** → **reCAPTCHA** 該 key 的「網域」設定中，加入  
`https://lbj-goat-meter.netlify.app`（你已確認控制台沒問題，此項僅作交叉驗證）。

---

## 總結與建議順序

| 項目 | 狀態 | 動作 |
|------|------|------|
| 1. Response Body | 待 Boss 提供 | 請貼 401 請求的 Response JSON 或截圖 |
| 2. Provider | ✅ 已確認 | 僅 ReCaptchaV3Provider，無 Enterprise |
| 3. Clear cache and deploy | 需手動 | Netlify → Trigger deploy → Clear cache and deploy；並確認 `VITE_APP_CHECK_SITE_KEY` = 6Lfes... |
| 4. Referer | 需手動 | Network → 401 請求 → Request Headers → 確認 Referer 為 `https://lbj-goat-meter.netlify.app/` |

取得 **1. Response Body** 與 **4. Referer** 結果後，可進一步判斷是 Token 無效、key 不符還是網域限制，並給出精準修正步驟。
