# 為什麼改「不限制金鑰」沒用？＋ 改用 reCAPTCHA Enterprise

## 你改的是哪一支 key？

畫面上的 **「Browser key (auto created by Firebase)”」** 是 **Firebase 的 Web API Key**（就是 `VITE_FIREBASE_API_KEY` 那支）。

- **用途**：前端打 **Firestore / Auth** 時，請求會帶這支 key。
- **不限制金鑰**：代表「任何來源、任何 API」都能用這支 key 打 Firebase，所以和 401/403 的「來源限制」無關。

## 401 發生在哪裡？

401 發生在 **Firebase 後端** 向 **Google** 驗證「這顆 reCAPTCHA token 是不是真的」的時候。

- 那一步用的是 **Firebase App Check 裡你填的「reCAPTCHA 密鑰」**（Secret Key），**不是** 上面那支 Browser key。
- 所以：改 Browser key 的「不限制金鑰」**不會**影響 reCAPTCHA 驗證，也**不會**消除 401。

---

## 若你的金鑰是「reCAPTCHA Enterprise」

你之前貼的畫面（總覽、整合、前端/後端、Account defender）是 **reCAPTCHA Enterprise**（在 Google Cloud Console 建立的那種）。

- 我們程式預設用的是 **ReCaptchaV3Provider**，對應的是 **標準 reCAPTCHA v3**（在 google.com/recaptcha/admin 建立的金鑰）。
- **Enterprise 金鑰** 要用 **ReCaptchaEnterpriseProvider**，驗證流程和 API 都不一樣；用錯就會 401。

### 你要做的兩件事

1. **Firebase Console → App Check**
   - 對你的 Web app，改用 **「reCAPTCHA Enterprise」** 提供者（不是「reCAPTCHA v3」）。
   - 把你在 Cloud Console 建立的那組 **Site Key** 填進去（Firebase 會引導你設定，必要時也會要你開 reCAPTCHA Enterprise API）。

2. **Netlify 環境變數**
   - 一樣用同一組 **Site Key** 填 `VITE_APP_CHECK_SITE_KEY`。
   - **多加一筆**：`VITE_APP_CHECK_USE_ENTERPRISE` = `1` 或 `true`。
   - 儲存後 **Clear cache and deploy**。

這樣前端會用 **ReCaptchaEnterpriseProvider**，和 Firebase App Check 的 Enterprise 設定一致，401 才有機會消失。

---

## 總結

| 項目 | 說明 |
|------|------|
| 改「不限制金鑰」 | 改的是 Firebase Browser API Key，**不影響** reCAPTCHA 驗證，所以對 401 沒用。 |
| 401 真正用的 key | Firebase App Check 裡填的 **reCAPTCHA 密鑰**（Secret），用來跟 Google 驗證 token。 |
| 若金鑰是 Enterprise | 在 Firebase 選 **reCAPTCHA Enterprise**，Netlify 加 `VITE_APP_CHECK_USE_ENTERPRISE=1`，重新部署。 |
