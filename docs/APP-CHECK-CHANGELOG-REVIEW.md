# App Check / 403 相關改動 — 工作成果檢查摘要

本文件為本次會話中與 App Check、401/403、嚴謹規則相關的改動與品質確認紀錄。

---

## 1. 程式碼改動清單

| 檔案 | 改動摘要 |
|------|----------|
| **firestore.rules** | 嚴謹模式：`hasValidAppCheck()` 還原為 `return request.appContext.appCheck != null;` |
| **src/lib/firebase.js** | ① App Check 支援 ReCaptchaEnterpriseProvider（`VITE_APP_CHECK_USE_ENTERPRISE`）② Production 診斷 log（key 為空、初始化失敗、未啟用時 warn）③ `__debugAppCheckGetToken` 除錯用 ④ 註解更新為 v3/Enterprise |
| **src/services/VoteService.js** | ① 投票前/重試前呼叫 `ensureFreshAppCheckToken()` ② 403 permission-denied 時自動重試一次（先刷新 token 再執行 Transaction）③ `runVoteTransaction` 內縮排修正 |
| **src/components/VotingArena.jsx** | 403/permission-denied 時顯示專用 i18n 文案 `submitErrorPermissionDenied` |
| **netlify.toml** | 全站 `Referrer-Policy: no-referrer-when-downgrade`，利於 reCAPTCHA 驗證來源 |
| **index.html** | `<meta name="referrer" content="no-referrer-when-downgrade" />` |
| **.env.example** | 註解補充 `VITE_APP_CHECK_USE_ENTERPRISE`（Enterprise 金鑰時使用） |
| **i18n (zh-TW / en)** | 新增 `submitErrorPermissionDenied` |

---

## 2. 正確性與邏輯

- **Firestore 規則**：僅在 `request.appContext.appCheck != null` 時允許寫入，與「嚴謹 App Check」需求一致。
- **Provider 選擇**：依 `VITE_APP_CHECK_USE_ENTERPRISE` 決定 `ReCaptchaV3Provider` 或 `ReCaptchaEnterpriseProvider`，同一 Site Key 僅會用一種。
- **重試邏輯**：僅在 `err?.code === "permission-denied"` 或 message 含 permission/insufficient/403 時重試一次，其餘錯誤直接拋出，避免無限重試或誤吞錯誤。
- **i18n**：403 專用訊息使用既有 `t()`，無硬編碼字串。

---

## 3. 程式碼品質

- **縮排**：`VoteService.runVoteTransaction` 內 `runTransaction` 的 callback 主體已統一為 2 空格縮排，與專案風格一致。
- **Lint**：`firebase.js`、`VoteService.js`、`VotingArena.jsx` 通過 ESLint，無新增錯誤。
- **Build**：`npm run build` 成功，無編譯錯誤。
- **註解**：firebase 頂部註解已更新為「reCAPTCHA v3 或 Enterprise」；關鍵分支（Enterprise 開關、重試條件）具簡短說明。

---

## 4. 文件與可維護性

- **docs/APP-CHECK-STRICT-MODE.md**：嚴謹模式檢查清單。
- **docs/APP-CHECK-403-DEBUG.md**：依 Console/Network 排查 403 步驟。
- **docs/APP-CHECK-401-CHECKLIST.md**：401 檢查（同一組金鑰、GCP API、新金鑰）。
- **docs/APP-CHECK-WRONG-APP.md**：確認「實際連線 app」與「改 App Check 的 app」一致。
- **docs/APP-CHECK-LAST-CHECKS.md**：僅單一 app 時的後續檢查與求助方式。
- **docs/APP-CHECK-BROWSER-KEY-VS-ENTERPRISE.md**：Browser key 與 401 的關係、改用 Enterprise 步驟。
- **docs/DEPLOY-DIAGNOSIS-401.md**：api2/pat 401 為 PAT 預期行為之說明。
- **docs/FIX-403-VOTE.md**：403 修復導向嚴謹模式與上述文件。

---

## 5. 建議後續動作（營運面）

- 若使用 **reCAPTCHA Enterprise** 金鑰：Firebase App Check 註冊為 Enterprise、Netlify 設 `VITE_APP_CHECK_USE_ENTERPRISE=1` 並 Clear cache and deploy。
- 部署 Firestore 規則：`firebase deploy --only firestore:rules`。
- 正式環境驗證：部署後在 Production 執行投票，確認 Console 無非預期錯誤、投票請求為 200。

以上改動已通過靜態檢查與建置，邏輯與文件一致，可作為上線與排查依據。
