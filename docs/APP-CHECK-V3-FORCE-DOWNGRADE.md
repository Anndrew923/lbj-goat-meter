# App Check 強制降級為 reCAPTCHA v3 + Debug 備案

## 1. 強制降級（已完成）

- 程式已 **100% 使用 `ReCaptchaV3Provider`**，已移除 `ReCaptchaEnterpriseProvider` 與 `VITE_APP_CHECK_USE_ENTERPRISE` 分支。
- 僅讀取 **`VITE_APP_CHECK_SITE_KEY`**，與 Firebase 標準版 reCAPTCHA v3 + Secret Key 對應。

## 2. 清除快取（Boss 手動）

- 在 **Netlify** 後台對該站執行 **「Clear cache and deploy」**，讓新 build 不含任何 Enterprise 殘留。
- 確認 Netlify 環境變數**沒有**設定 `VITE_APP_CHECK_USE_ENTERPRISE`（或已刪除），避免舊值被帶入。

## 3. Debug 備案：若仍 403，手動印出 getToken() 結果

部署後若投票仍 403，可在 **Production 站** 打開 **F12 → Console**，執行：

```js
__debugAppCheckGetToken()
```

- **成功**：Console 會印出 `[Firebase] getToken() 成功，預覽: xxxxx... (長度 n)`（僅預覽，不輸出完整 token）。
- **失敗**：會印出 `[Firebase] getToken() 失敗: ...` 與錯誤訊息，可依此判斷是 reCAPTCHA 401 或其它原因。

此函式掛在 `window` 上，僅供診斷用，不影響正式流程。
