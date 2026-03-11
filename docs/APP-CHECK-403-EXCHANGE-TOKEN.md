# App Check 403 發生在「交換 Token」階段（exchangeRecaptchaEnterpriseToken）

## 錯誤長相

- **Network**：對 `content-firebaseappcheck.googleapis.com` 的 `POST` 請求失敗（403）
- **路徑**：`/v1/projects/.../apps/.../exchangeRecaptchaEnterpriseToken`
- **Console**：`AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle)` 或 `appCheck/throttled`

代表 403 發生在「用 reCAPTCHA Enterprise token 向 Firebase 換 App Check token」這一步，**不是** Firestore 寫入。

## 可能原因

| 項目 | 說明 |
|------|------|
| **金鑰不一致** | Firebase Console → App Check → reCAPTCHA Enterprise 填的「網站金鑰」必須與 GCP reCAPTCHA Enterprise 該金鑰的「網站金鑰」完全一致（複製貼上，注意 0/O、l/1）。 |
| **網域未放行** | GCP reCAPTCHA Enterprise → 該金鑰 → 網域需包含實際使用網址（例如 `lbj-goat-meter.netlify.app`、本機則加 `localhost`）。 |
| **GCP 專案不同** | reCAPTCHA Enterprise 金鑰必須建在「與 Firebase 專案連結的同一 GCP 專案」；不同專案會導致 Firebase 無法驗證 → 403。 |
| **金鑰類型** | 須為 reCAPTCHA **Enterprise** 的網站金鑰（Score-based / 無勾選 checkbox），不是舊版 reCAPTCHA v2/v3 標準版。 |

## 節流（Throttle）

連續 403 後，Firebase 會回傳 `appCheck/initial-throttle` / `appCheck/throttled`，並限制同一環境約 **24 小時**內再次嘗試。

- **可做**：用本機 localhost + [Debug Token](https://firebase.google.com/docs/app-check/web/debug-provider) 先驗證規則與流程（不依賴 exchangeRecaptchaEnterpriseToken）。
- **或**：等節流時間過後，確認上述清單都正確再重試 Production。

## 建議檢查清單

1. GCP reCAPTCHA Enterprise：該金鑰的「網域」是否包含 `lbj-goat-meter.netlify.app`？
2. Firebase Console App Check：reCAPTCHA Enterprise 提供者裡填的是「網站金鑰」（從 GCP 該金鑰複製），不是 Secret、不是 API Key。
3. Firebase 專案與 reCAPTCHA 金鑰是否在同一個 GCP 專案？（Firebase 專案設定 → 可查連結的 GCP 專案）
