# 突發戰區與管理後台 — 工作總結（存查）

本文為「突發戰區通用引擎、管理後台、動態雙語、圖片上傳與權限」相關開發的完整總結，供存查與後續維護參考。

---

## 一、突發戰區通用引擎與 UI 殼層重構

### 1.1 VotingArena.jsx 重構（外殼包裝模式）

- **目標**：移除 `if (hasVoted)` 的早退式渲染，改為單一出口的「外殼包裝」。
- **作法**：
  - 以 `contentMode` 決定顯示內容：`loading` | `limbo` | `guest` | `no_warzone` | `voted` | `form`。
  - 單一 `<div class="voting-arena-wrapper">` 包住所有 DynamicContent 區塊。
  - 其後固定渲染：LoginPromptModal（limbo/guest）、AnimatePresence + BattleCardContainer、AdMobPortal、存檔確認 Modal。
- **效果**：上層（VotePage）可固定插入「突發話題入口」，不受 `hasVoted` 影響，投票前／投票後都會顯示。

### 1.2 VotePage 佈局順序

- **順序**：`LiveTicker` → `UniversalBreakingBanner` → `motion.main`（內含 `VotingArena` 與其餘區塊）。
- **目的**：突發話題入口在畫面上始終存在，不因是否已投票而消失。

### 1.3 跨專案邏輯與常數

- **Firestore 集合**：單一集合 `global_events`（常數：`GLOBAL_EVENTS_COLLECTION`）。
- **專案識別**：`PROJECT_APP_ID = 'goat_meter'`（常數：`src/lib/constants.js`）。
- **過濾邏輯**：App 僅讀取 `target_app` 陣列包含當前 `PROJECT_APP_ID` 且 `is_active === true` 的文件。

### 1.4 useGlobalBreakingEvents Hook

- **路徑**：`src/hooks/useGlobalBreakingEvents.js`。
- **功能**：訂閱 `global_events`，條件為 `target_app` array-contains 當前 appId、`is_active == true`，上限 5 筆；客戶端依 `createdAt` 排序。
- **回傳**：`{ events, loading, error }`。events 為文件陣列（含 id、title、description、image_url、options 等）。

### 1.5 UniversalBreakingBanner 組件

- **路徑**：`src/components/UniversalBreakingBanner.jsx`。
- **功能**：依 `useGlobalBreakingEvents` 顯示突發活動；標題／描述／選項依當前語系從語系物件取值，缺語系時 fallback 到英文（透過 `getLocalizedText`）。
- **樣式**：暗黑競技風、16:9 圖區、金/紫邊框；無活動時不佔位。

---

## 二、管理後台 UniversalAdmin

### 2.1 頁面與路由

- **路徑**：`src/pages/UniversalAdmin.jsx`。
- **路由**：`/admin`，已包在 `ProtectedRoute` 內，**需登入（或匿名）才能進入**，以符合 Storage / Firestore 的「已登入可寫」規則。

### 2.2 表單欄位與 Firestore 結構

| 欄位 | 表單形式 | 寫入 Firestore 格式 |
|------|----------|----------------------|
| target_app | 單行文字（逗號分隔） | 陣列，如 `['goat_meter']` |
| title | 雙語：標題 zh-TW、標題 en | `{ "zh-TW": "...", "en": "..." }` |
| description | 雙語：描述 zh-TW、描述 en | `{ "zh-TW": "...", "en": "..." }` |
| image | 拖拽或點選上傳 | 上傳至 Storage 後寫入 `image_url`（字串） |
| options | 雙語：選項 zh-TW、選項 en（逗號分隔） | 陣列 `[{ "zh-TW": "...", "en": "..." }, ...]`，依序 zip |
| is_active | 核取方塊 | 布林 |

- **寫入時**：`addDoc(collection(db, 'global_events'), { target_app, title, description, image_url, options, is_active, createdAt: serverTimestamp() })`。
- **驗證**：必填 `target_app`、標題英文（`title.en`）作為 fallback。

### 2.3 圖片上傳與失敗處理

- **上傳**：使用 Firebase Storage，路徑 `global_events/{timestamp}_{filename}`。
- **失敗不阻斷發布**：若上傳失敗（例如曾發生的 CORS），仍寫入 Firestore（`image_url` 為 null），並顯示 `adminSavedNoImage` 提示（i18n 鍵已存在）。

---

## 三、動態多語系（雙語存儲）

### 3.1 管理端

- 所有文字欄位（標題、描述、選項）提供 **zh-TW 與 en** 輸入框。
- 提交時組裝為語系物件寫入 Firestore（見上表）。

### 3.2 前端取文案

- **工具**：`src/lib/localeUtils.js` 的 `getLocalizedText(localeMap, language)`。
  - 若為字串（舊資料）直接回傳；若為物件則依 `language` 取值，缺則 fallback 到 `en`；語系為 `zh` 時會對應到 `zh-TW`。
- **Banner**：使用 `useTranslation` 取得 `i18n.language`，渲染時以 `getLocalizedText(ev.title, lang)` 等方式取得標題／描述／選項，確保缺語系時自動 fallback 英文。

### 3.3 i18n 鍵（common.json）

- 後台：`adminTitleZh`, `adminTitleEn`, `adminDescriptionLabel`, `adminDescriptionZh/En`, `adminOptionsZh/En`, `adminSavedNoImage`, `adminErrorTitleEnRequired` 等（en / zh-TW 皆已加）。

---

## 四、圖片上傳與 CORS

### 4.1 問題

- 從 localhost（例如 `http://localhost:2323`）上傳至 Firebase Storage 時，瀏覽器 preflight（OPTIONS）被擋，出現 **CORS policy** 與 **403 / net::ERR_FAILED**。

### 4.2 解法

- **CORS 設定檔**：專案根目錄 `storage-cors.json`，允許 localhost 常見埠（2323、5173、3000）及 127.0.0.1，method 含 GET, HEAD, PUT, POST, OPTIONS。
- **套用方式**：在 **Google Cloud Shell** 執行腳本（或複製 `scripts/apply-storage-cors-cloudshell.sh` 內容），對儲存貯體執行：
  `gsutil cors set /tmp/cors.json "gs://lbj-goat-meter.firebasestorage.app"`。
- **文件**：`docs/STORAGE-CORS-SETUP.md` 內有完整步驟（含先執行 `gsutil ls` 確認儲存貯體名稱）。

### 4.3 儲存貯體名稱

- 本專案使用：**`lbj-goat-meter.firebasestorage.app`**（需在 Firebase Console > Storage 啟用後才會存在；若曾出現 404，多為尚未建立或名稱不同，可依 Console 或 CORS 錯誤網址中 `/v0/b/` 後方名稱調整）。

---

## 五、Firebase Storage 規則

### 5.1 規則內容

- **檔案**：`storage.rules`（專案根目錄）；`firebase.json` 已設定 `"storage": { "rules": "storage.rules" }`。
- **邏輯**：
  - `global_events/**`：`allow read: if true`；`allow write: if request.auth != null`。
  - 其餘路徑：`allow read, write: if false`。
- **部署**：`npx firebase deploy --only storage`（因網頁 Console 無法編輯規則，改為本機編輯後部署）。

---

## 六、Firestore 規則（global_events）

### 6.1 問題

- 原先 `firestore.rules` 未包含 `global_events`，寫入時回傳 **Missing or insufficient permissions**。

### 6.2 新增規則

- **集合**：`global_events/{eventId}`。
- **讀取**：`allow read: if true`（前端橫幅需公開讀）。
- **寫入**：`allow create, update, delete: if isAuthenticated()`（僅已登入可發布／修改／刪除）。
- **部署**：`npx firebase deploy --only firestore:rules`。

---

## 七、後台權限與路由

- **/admin** 改為包在 `ProtectedRoute` 內，需先登入（或匿名）才能進入。
- **目的**：上傳圖片與寫入 Firestore 時 `request.auth != null`，符合 Storage 與 Firestore 規則，避免 403 / permission 錯誤。

---

## 八、相關檔案清單（新增／修改）

| 類型 | 路徑 |
|------|------|
| 常數 | `src/lib/constants.js`（PROJECT_APP_ID, GLOBAL_EVENTS_COLLECTION） |
| Hook | `src/hooks/useGlobalBreakingEvents.js` |
| 工具 | `src/lib/localeUtils.js`（getLocalizedText） |
| 組件 | `src/components/UniversalBreakingBanner.jsx` |
| 組件 | `src/components/VotingArena.jsx`（wrapper + contentMode） |
| 頁面 | `src/pages/UniversalAdmin.jsx` |
| 頁面 | `src/pages/VotePage.jsx`（插入 UniversalBreakingBanner） |
| 路由 | `src/App.jsx`（/admin、ProtectedRoute） |
| Firebase | `firebase.json`（storage.rules）、`storage.rules`、`firestore.rules`（global_events） |
| CORS | `storage-cors.json`、`scripts/apply-storage-cors-cloudshell.sh`、`scripts/apply-storage-cors.mjs` |
| 文件 | `docs/STORAGE-CORS-SETUP.md`、`docs/SUMMARY-BREAKING-ARENA-AND-ADMIN.md`（本檔） |
| i18n | `src/i18n/locales/en/common.json`、`src/i18n/locales/zh-TW/common.json`（breaking / admin 相關鍵） |
| Firebase 模組 | `src/lib/firebase.js`（getStorage、storage 匯出） |
| 依賴 | `package.json`（storage:cors 腳本、@google-cloud/storage devDependency） |

---

## 九、操作檢查清單（日後重現／排查用）

1. **突發橫幅有資料**：Firestore `global_events` 有文件且 `target_app` 含 `goat_meter`、`is_active == true`。
2. **後台可發布**：已登入、Firestore 與 Storage 規則已部署；若為新環境，需先執行 CORS 設定與 Storage 啟用。
3. **localhost 上傳成功**：已對 `lbj-goat-meter.firebasestorage.app` 套用 CORS（Cloud Shell 或本機 `STORAGE_BUCKET=... npm run storage:cors`）。
4. **規則更新**：Storage 改 `storage.rules` 後執行 `npx firebase deploy --only storage`；Firestore 改 `firestore.rules` 後執行 `npx firebase deploy --only firestore:rules`。

---

*文件產生日期：依本對話完成時間存查。*
