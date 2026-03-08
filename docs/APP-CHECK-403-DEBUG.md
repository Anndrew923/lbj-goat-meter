# 403 排查步驟（不瞎猜，依 Console 判斷）

已在前端加上 **Production 診斷 log**。請照下面做，依 Console 顯示判斷問題點。

---

## 步驟 1：開 Production 站 + Console

1. 打開 **https://lbj-goat-meter.netlify.app/**（或你的正式網址）
2. **F12** → **Console** 標籤
3. 重新整理頁面一次，看載入時印出的訊息

---

## 步驟 2：看這三行

| Console 會出現的訊息 | 代表什麼 | 你要做的事 |
|----------------------|----------|------------|
| `[Firebase] App Check Site Key (VITE_APP_CHECK_SITE_KEY): (空)` 或 長度 0 | **Build 時沒有帶到 Site Key**（Netlify 環境變數沒進 build） | 確認 Netlify 有 `VITE_APP_CHECK_SITE_KEY`，且做一次 **Clear cache and deploy** |
| `[Firebase] App Check 未啟動：VITE_APP_CHECK_SITE_KEY 為空...` | 同上 | 同上 |
| `[Firebase] App Check Site Key ... (長度 40)` 之類 | Site Key 有打進 bundle | 繼續看下一行 |
| `[Firebase] App Check 已啟用（reCAPTCHA v3）` | App Check 初始化成功 | 若還是 403，可能是 **Firebase 後端**（Secret Key 或規則），見下方 |
| `[Firebase] App Check 初始化失敗，寫入將被規則拒絕（403）：...` | reCAPTCHA 初始化就失敗了（例如 401、網路、key 錯） | 看錯誤內容：401 → 網域／Referer；其他 → 依訊息查 |
| 點投票時出現 `[Firebase] App Check 未啟用，此請求將不會帶 App Check token...` | 上面初始化沒成功，所以沒帶 token | 回頭看載入時是「(空)」還是「初始化失敗」 |

---

## 步驟 3：確認 Request 有沒有帶 Token（可選）

1. F12 → **Network**
2. 篩選 **Fetch/XHR**，點一次「投下神聖一票」
3. 找到對 **firestore.googleapis.com** 的 **documents:commit** 請求，點進去
4. 看 **Request Headers** 有沒有 **`X-Firebase-AppCheck`**
   - **有**：前端有送 token，403 多半是 **Firebase 後端**（Secret Key 與該 Site Key 是否一對、或規則未部署）
   - **沒有**：前端沒帶 token → 對應「App Check 未啟用」或「初始化失敗」，照步驟 2 的對應項處理

---

## 常見對應

| 狀況 | 可能原因 | 解法 |
|------|----------|------|
| Site Key 顯示 (空) | Netlify 變數沒在 build 時注入 | 變數名確認為 `VITE_APP_CHECK_SITE_KEY`，儲存後 **Clear cache and deploy** |
| 初始化失敗 + 401 / Unauthorized | reCAPTCHA 不認你的網域或 Referer | reCAPTCHA Admin 網域加 `lbj-goat-meter.netlify.app`；確認 Netlify 有設 Referrer-Policy（見 netlify.toml） |
| 已啟用、有 X-Firebase-AppCheck 仍 403 | Firebase 驗證 token 失敗 | Firebase Console → App Check → 該 Web 的 **Secret Key** 要與 reCAPTCHA Admin 裡「同一組」金鑰的密鑰一致；並執行 `firebase deploy --only firestore:rules` |

依 Console 實際輸出對照上表，就能鎖定是哪一環出問題，不用猜字元或複製貼上。
