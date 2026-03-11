# Production 正式環境 Secret 設定指南

本文件指導 Boss 在 **Firebase / GCP Console** 中設定正式環境所需 Secret，使 Cloud Functions 能於 Netlify 正式網域上正確執行 reCAPTCHA 與廣告獎勵驗證。

---

## 1. 必要 Secret 清單

| 變數名稱 | 說明 | 取得方式 |
|----------|------|----------|
| `RECAPTCHA_SECRET` | reCAPTCHA v3 / Enterprise 後端 Secret Key | [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin) 取得對應網站的 Secret Key |
| `AD_REWARD_SIGNING_SECRET` | 廣告獎勵自簽 Token 用 HMAC 密鑰 | 自行產生一組隨機字串（建議 32+ 字元），僅後端持有 |
| `AD_REWARD_VERIFY_ENDPOINT` | （選用）廣告供應商驗證 API URL | 若接 Google SSV 等外部驗證 Webhook，填寫完整 POST 端點 |

---

## 2. 在 GCP Secret Manager 中建立 Secret

### 2.1 開啟 Secret Manager

1. 登入 [Google Cloud Console](https://console.cloud.google.com/)
2. 選擇與 Firebase 專案相同的 **Project**
3. 左側選單：**Security** → **Secret Manager**
4. 若尚未啟用 API，點選 **Enable**

### 2.2 建立各 Secret

- **RECAPTCHA_SECRET**
  - 點 **Create Secret**
  - Name：`RECAPTCHA_SECRET`（或自訂名稱，部署時需對應）
  - Secret value：貼上 reCAPTCHA 後端 Secret Key
  - 建立

- **AD_REWARD_SIGNING_SECRET**
  - 點 **Create Secret**
  - Name：`AD_REWARD_SIGNING_SECRET`
  - Secret value：自行產生隨機字串（例如：`openssl rand -base64 32` 輸出）
  - 建立

- **AD_REWARD_VERIFY_ENDPOINT**（選用）
  - 若有外部廣告驗證 API，可建立一筆 Secret 存完整 URL
  - 或改以 **Firebase Functions 環境變數** 設定（非敏感可放 .env）

---

## 3. 將 Secret 提供給 Cloud Functions

目前專案使用 **Firebase Cloud Functions (1st gen)**，可採以下任一方式將 Secret 注入為環境變數。

### 方式 A：本地 .env 部署（建議用於 Staging / 小團隊）

1. 在專案根目錄的 `functions/` 下建立 **不提交版控** 的環境檔：
   - 檔名：`.env.production` 或 `.env.<your-firebase-project-id>`
2. 內容範例：
   ```bash
   RECAPTCHA_SECRET=你的_reCAPTCHA_Secret_Key
   AD_REWARD_SIGNING_SECRET=你產生的_32字元以上_隨機字串
   # 選用：若使用外部廣告驗證 API
   AD_REWARD_VERIFY_ENDPOINT=https://your-ssv-callback.example.com/verify
   ```
3. 確認 `functions/.gitignore` 已包含 `.env.*`，避免 Secret 進版控。
4. 部署時在 `functions/` 目錄或專案根目錄執行：
   ```bash
   firebase deploy --only functions
   ```
5. 若使用 dotenv：在 `functions/index.js` 頂層（僅在 Node 環境）載入：
   ```js
   import dotenv from 'dotenv';
   if (process.env.NODE_ENV !== 'production') dotenv.config();
   // 或依檔名：dotenv.config({ path: '.env.production' });
   ```
   實際作法依你目前是否有使用 dotenv 而定；若未使用，可改以 **方式 B** 在 GCP 設定。

### 方式 B：GCP Cloud Functions 環境變數（Console）

1. 前往 [Firebase Console](https://console.firebase.google.com/) → 專案 → **Functions**
2. 若已改為使用 **Google Cloud Console** 管理：
   - [Cloud Console](https://console.cloud.google.com/) → **Functions** → 選擇對應的 function（如 `submitVote`, `resetPosition`, `issueAdRewardToken`）
3. 編輯 function → **Runtime, build, connections and security** → **Runtime environment variables**
4. 新增：
   - `RECAPTCHA_SECRET` = （從 Secret Manager 複製的值）
   - `AD_REWARD_SIGNING_SECRET` = （從 Secret Manager 複製的值）
   - （選用）`AD_REWARD_VERIFY_ENDPOINT` = 驗證 API URL
5. 儲存並重新部署該 function（或整批重新 deploy）。

### 方式 C：Secret Manager 綁定（2nd gen / 進階）

若未來升級為 **Cloud Functions 2nd gen**，可改為使用 `defineSecret` 將 Secret Manager 的 secret 綁定到 function，由 Runtime 自動注入，無需手動複製到 .env。屆時可再調整程式碼與部署設定。

---

## 4. 安全與營運提醒

- **RECAPTCHA_SECRET**：僅後端使用，切勿寫入前端或提交版控。
- **AD_REWARD_SIGNING_SECRET**：僅後端使用，用於簽發/驗證「看完廣告」之 Token；外洩將導致任何人可偽造廣告完成。
- **AD_REWARD_VERIFY_ENDPOINT**：若為 HTTPS 且無敏感參數，可視需求改為一般環境變數。
- **ALLOWED_WEB_ORIGIN**（選用）：網頁版無廣告 SDK 時，前端傳 `web-no-ad-sdk`，後端僅接受此環境變數所列的 origin 放行重置。預設為 `https://lbj-goat-meter.netlify.app`；若有多網域可設為逗號分隔，例如 `https://app.example.com,https://lbj-goat-meter.netlify.app`。
- 正式環境部署完成後，請在 **Netlify 正式網域** 上實際走一輪：**看廣告 → 重置立場 → 重新投票**，並確認 `global_summary` 統計正確。

---

## 5. 驗證是否生效

- **submitVote**：從 Netlify 網域發起投票時，須通過 reCAPTCHA 分數（minScore 0.5），未通過則得到 `low-score-robot` 錯誤；僅投票會影響數據可信度，故在此嚴格驗證。localhost 可略過驗證。
- **resetPosition**：不檢查 reCAPTCHA 分數；僅驗證「廣告獎勵 Token」或「web-no-ad-sdk + 允許的 origin」。重置僅撤銷一票，不影響整體數據可信度。localhost 可略過驗證。
- 後端日誌中可確認 `[submitVote] metadata` 是否正確記錄 `ip` 與 `userAgent`，供後續社會風向計人工審核使用。

完成上述設定後，即完成 Production 安全硬化與正式環境 Secret 綁定；部署至正式環境後請依 Staging 驗收項目執行驗收。
