# 投票 403（Permission Denied）— 嚴謹 App Check 模式

本專案已恢復 **嚴謹規則**：Firestore 要求有效 App Check token，以保護投票結果不被腳本攻擊。  
若出現 403，代表請求未帶有效 App Check（或 reCAPTCHA 未成功發出 token）。

## 正確做法：讓 App Check 通過

請依 ** [APP-CHECK-STRICT-MODE.md](./APP-CHECK-STRICT-MODE.md)** 完成：

1. **reCAPTCHA Admin**：網域包含 `lbj-goat-meter.netlify.app`（或你的正式網域）
2. **Firebase App Check**：reCAPTCHA v3 的 Site Key / Secret Key 正確
3. **Netlify**：`VITE_APP_CHECK_SITE_KEY` 設為該 Site Key，並 **Clear cache and deploy**
4. **Referrer-Policy**：已由 `netlify.toml` 與 `index.html` 設定，勿改為 `no-referrer`
5. **部署 Firestore 規則**：`firebase deploy --only firestore:rules`（規則為嚴謹的 `hasValidAppCheck()`）

完成後，投票應在嚴謹規則下正常通過，無須放寬規則。

## 若仍 403

- 重新登入後再試（排除 token 過期）
- 檢查瀏覽器 Network：對 `firestore.googleapis.com` 的請求 Request Headers 是否帶有 `X-Firebase-AppCheck`（由 SDK 自動附加）
- 開發環境可暫時使用 Debug Token（Firebase Console > App Check > 管理偵錯權杖）或 `.env.local` 設 `VITE_APP_CHECK_SKIP_IN_DEV=1`（僅限開發）
