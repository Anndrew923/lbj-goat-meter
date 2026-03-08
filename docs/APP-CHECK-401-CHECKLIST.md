# App Check / siteverify 401 — 不假設複製錯誤的檢查清單

以下依「同一組金鑰、後端 API、新金鑰」順序排查，不預設是複製貼上問題。

---

## 1. 確認是「同一筆」金鑰的兩欄

reCAPTCHA Admin 裡**一筆**設定會同時有：
- **網站金鑰**（給 Netlify `VITE_APP_CHECK_SITE_KEY`）
- **密鑰**（給 Firebase App Check「reCAPTCHA 密鑰」）

兩者必須是**同一筆**的兩欄，不能是兩筆不同金鑰。

- 在 reCAPTCHA Admin 打開你現在用在 Netlify 的那一筆（看 Site Key 前幾碼對一下）。
- 同一個畫面／同一筆裡，應該就有對應的「密鑰」。
- Firebase 裡填的密鑰，**只能是這一筆的密鑰**。若你有兩筆 v3 金鑰（例如一個 dev、一個 prod），容易搞混：請對一下 Netlify 的 Site Key 前幾碼，確定 Firebase 填的是「那一筆」的密鑰。

---

## 2. Google Cloud 專案 — 是否要開 reCAPTCHA API

Firebase 專案背後對應一個 **Google Cloud 專案**。驗證時有可能會用到該專案裡的 API。

- 打開 [Google Cloud Console](https://console.cloud.google.com/)
- 左上選專案時，選**和 Firebase 同一個**專案
- **API 與服務** → **已啟用的 API**（或「程式庫」）
- 搜尋 **reCAPTCHA**
- 若有 **reCAPTCHA API** 或 **reCAPTCHA Enterprise API**，且狀態是「已停用」，請**啟用**後再試一次投票

（不確定你專案用的是哪一個，兩個都看一下無妨。）

---

## 3. 用一組「全新的」reCAPTCHA v3 金鑰測試

用來排除「某一筆金鑰」本身有問題（例如曾被停用、或設定異常）。

1. reCAPTCHA Admin → **建立一筆新的** reCAPTCHA v3 金鑰（類型選 v3、平台選網頁）。
2. **網域**照樣加 `lbj-goat-meter.netlify.app`（與 localhost 如需）。
3. 這筆新金鑰會有新的**網站金鑰**和**密鑰**。
4. Netlify：`VITE_APP_CHECK_SITE_KEY` 改成這筆的**網站金鑰**，儲存後 **Clear cache and deploy**。
5. Firebase App Check：**reCAPTCHA 密鑰**改成這筆的**密鑰**，儲存。
6. 等 1～2 分鐘再試投票。

- 若**新金鑰可以**：多半是舊金鑰狀態或設定有問題，之後就用新金鑰即可。
- 若**新金鑰一樣 401**：問題就不在「有沒有複製錯」，而在專案設定或 API 啟用（回到上面 1、2）。

---

## 4. 若仍 401 — 給工程師／Firebase 的資訊

可把下面幾點整理給後端或查文件用：

- Firebase 專案 ID（例如 `lbj-goat-meter`）。
- reCAPTCHA 金鑰是 v3、網頁用、與 Netlify 使用同一筆的 Site Key / Secret。
- 已在同專案的 Google Cloud Console 檢查過 reCAPTCHA 相關 API 已啟用。
- 錯誤發生在「投票時、Firestore 寫入前／時」，且 Console 有 siteverify（或 exchange token）401。

這樣可以避免再被歸因成「複製錯」，專心查專案與 API 設定。
