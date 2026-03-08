# App Check 仍 401/403 — 只剩一個 App 時的檢查

已確認只有一個 Web app，不是「改錯應用程式」。下面是最後幾項可對的設定與求助方式。

---

## 1. reCAPTCHA 金鑰的「所屬專案」

reCAPTCHA 金鑰會綁在一個 **Google Cloud 專案**上；Firebase 專案其實就是同一個 GCP 專案。  
若金鑰是綁在**另一個** GCP 專案，Firebase 在驗證 token 時有可能出問題。

- 在 **reCAPTCHA Admin**（google.com/recaptcha/admin）打開你用的那筆 v3 金鑰，看畫面上有沒有顯示 **「專案」或「Google Cloud 專案」**。
- 在 **Firebase Console** 左側專案名稱旁，或 **專案設定** 裡，確認 **專案 ID**（例如 `lbj-goat-meter`）。
- 兩邊必須是**同一個專案**。若 reCAPTCHA 金鑰綁在別個專案，請在 reCAPTCHA Admin **建立一筆新** v3 金鑰，並在建立時選 **Firebase 用的那個專案**（與上面專案 ID 相同），再把這筆的 Site Key / Secret 分別填回 Netlify 與 Firebase App Check。

---

## 2. 向 Firebase / Google 求助

你已經做過：同一組金鑰、新金鑰、API 啟用、只一個 app、複製貼上沒問題，仍 401/403，很可能是後端驗證或專案設定層面的問題。

建議：

- **Firebase 說明文件**：在 [App Check reCAPTCHA v3 文件](https://firebase.google.com/docs/app-check/web/recaptcha-provider) 頁面底下有「回饋」或「問題回報」。
- **Google 社群**：到 [Firebase Google Group](https://groups.google.com/g/firebase-talk) 或 [Stack Overflow 的 firebase 標籤](https://stackoverflow.com/questions/tagged/firebase) 發文，附上：
  - 使用 reCAPTCHA v3 + Firebase App Check（Web）
  - 一個 Web app、金鑰與網域都確認過、已試過新金鑰與啟用 API
  - 錯誤：驗證時 401、Firestore 寫入 403 permission-denied
  - **不要**貼出密鑰或 Site Key 全文，可寫「已確認同一組 Site Key / Secret、專案只有一個 Web app」

---

## 3. 若需要先讓投票能動（暫時方案）

若短期內必須讓站能投票，且可接受**暫時**放寬 App Check：

- 在 `firestore.rules` 把 `hasValidAppCheck()` 暫時改成 `return true;`，部署規則。
- 這樣 403 會消失、投票可寫入，但**沒有** App Check 防護，僅適合當過渡，之後仍要查 401 根因並改回嚴謹規則。

你已確認沒有兩個 app，就從「reCAPTCHA 專案是否與 Firebase 同專案」和「向 Firebase/社群求助」這兩條線繼續查即可。
