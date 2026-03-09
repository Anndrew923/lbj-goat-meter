# reCAPTCHA 400 Bad Request：別把「密鑰」當「網站金鑰」用

當 Console 出現：

- `POST https://www.google.com/recaptcha/api2/clr?k=6LfesYMsAAAAA...` → **400 (Bad Request)**
- `AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)`

且你的 key 是 **40 字元、以 6L 開頭**，很可能是：**前端用了「密鑰」(Secret Key)，而不是「網站金鑰」(Site Key)**。

---

## 兩支 key 的差別

| 名稱 | 用途 | 填在哪裡 | 範例中段（僅供辨識） |
|------|------|----------|----------------------|
| **網站金鑰 (Site Key)** | 給瀏覽器／前端用 | **Netlify** `VITE_APP_CHECK_SITE_KEY`、前端程式 | 中段常含 `Jeldp8...`、結尾常似 `...DQb90` |
| **密鑰 (Secret Key)** | 給後端驗證用 | **Firebase Console** App Check 的「reCAPTCHA 密鑰」 | 中段常含 `Jv10s6...`、結尾常似 `...THluBDucm` |

- 若請求網址裡的 `k=` 是 **`...Jv10s6Lo5t8zouut-_THIuBDucm`** 或 **`...THluBDucm`**，那是**密鑰的格式**。
- 前端必須用 **網站金鑰**，長相會不同（例如中段是 `Jeldp8...`、結尾是 `...DQb90`）。

---

## 正確做法

1. 打開 **reCAPTCHA Admin**，進入你用的那組 reCAPTCHA v3 金鑰。
2. 在該頁找到 **「網站金鑰」**（說明會寫：用於 HTML／用戶端），點 **「複製網站金鑰」**。
3. **不要**複製「密鑰」或「複製密鑰」。
4. 到 **Netlify** → 環境變數 → **`VITE_APP_CHECK_SITE_KEY`** → 貼上**剛複製的網站金鑰**（整段替換）。
5. 儲存後執行 **Clear cache and deploy**。
6. 再試投票；請求網址裡的 `k=` 應變成另一串（網站金鑰），400 才會消失。

---

## 如何確認沒搞混

- **Firebase App Check** 裡「reCAPTCHA 密鑰」欄位 = 只填 **密鑰**（從 reCAPTCHA Admin「複製密鑰」）。
- **Netlify** `VITE_APP_CHECK_SITE_KEY` = 只填 **網站金鑰**（從 reCAPTCHA Admin「複製網站金鑰」）。

兩支 key 長度都約 40、都 6L 開頭，但**內容不同**；填反或貼錯會導致 400 與 `appCheck/recaptcha-error`。
