# localhost 出現 403（securetoken.googleapis.com）— 投票／登入被踢出

當在 **localhost** 開發時，Console 出現：

- `POST https://securetoken.googleapis.com/v1/token?... 403 (Forbidden)`
- 接著出現 `[ProtectedRoute] Redirecting because not authenticated`

代表 **Firebase Auth 的 token 刷新** 被擋，瀏覽器拿不到新 token，App 就判定為未登入並導回登入頁，**突發戰區投票也不會成功**（後端需已登入）。

---

## 原因

Firebase 網頁用的 **API 金鑰** 在 Google Cloud 設定了 **「HTTP referrers (網站)」** 限制時，只有清單內的來源可以呼叫 Google API。  
Token 刷新請求會帶上目前頁面的 **Referer**（例如 `http://localhost:2323`）。若清單裡**沒有**你現在用的 localhost 網址，`securetoken.googleapis.com` 就會回 **403**。

---

## 解法：在 API 金鑰加入 localhost 參照網址

1. 打開 [Google Cloud Console](https://console.cloud.google.com) → 選專案 **lbj-goat-meter**（與 Firebase 同專案）。
2. 左側 **APIs & Services** → **Credentials**（憑證）。
3. 在 **API 金鑰** 區塊找到專案用的金鑰（與 `.env` 裡 `VITE_FIREBASE_API_KEY` 或 Firebase 專案設定中的 Web API 金鑰相同）。
4. 點該金鑰名稱進入編輯。
5. 在 **Application restrictions**（應用程式限制）：
   - 若為 **None**：理論上不會因 referrer 被擋，可再檢查是否為其他 403 原因（例如專案停用 Identity Toolkit API）。
   - 若為 **HTTP referrers (websites)**：在 **Website restrictions**（參照網址）中**新增**你實際使用的網址，例如：
     - `http://localhost:2323/*`
     - `http://localhost:5173/*`
     - `http://127.0.0.1:2323/*`
     - `http://127.0.0.1:5173/*`  
     （依你 `npm run dev` 的 port 調整；可多列幾個常用 port 以備切換。）
6. 儲存。等待約 1～2 分鐘讓設定生效。
7. 重新整理 localhost 頁面，**重新登入**後再試突發戰區投票。

完成後，token 刷新不應再 403，登入狀態會維持，投票流程可正常走到「確認投下」並成功。
