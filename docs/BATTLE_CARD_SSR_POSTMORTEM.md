### 📝 THE GOAT METER：戰報卡 SSR 模組開發全量決算報告

本文件為戰報卡後端渲染（`generateBattleCard` + `battleCardVisualHtml`）之**技術演進與避坑全紀錄**。重點不僅是「現在怎麼做對了」，也包含多條已放棄或修正路徑的**失敗細節與取捨原因**，供後續維運與橫向複製到其他球星模組時參考。

---

#### 1. 核心指標與最終架構

| 項目 | 最終確定值 | 說明 |
|------|------------|------|
| **CPU** | **2 vCPU** | `generateBattleCard` 專用 Callable 設定（與全域 `setGlobalOptions` 的預設分離）。 |
| **記憶體** | **2GiB** | 承載 Chromium 解壓、頁面合成與 JPEG 截圖；低於此易在尖峰或字型／圖片載入時 OOM。 |
| **函式逾時** | **180s**（`GENERATE_BATTLE_CARD_TIMEOUT_SEC`） | 涵蓋冷啟、Chromium 啟動、`networkidle0`、字型與頭像載入、雙 rAF 就緒訊號。 |
| **Puppeteer 協定逾時** | **180_000 ms**（`protocolTimeout`） | 與函式層 180s 對齊，避免 CDP 層先於業務逾時斷線。 |
| **setContent 逾時** | **60_000 ms** | `waitUntil: "networkidle0"` 上限，須明顯小於函式總逾時。 |
| **就緒訊號逾時** | **90_000 ms** | `#render-ready-signal` 等待上限；超時僅警告並強制截圖。 |
| **傳輸路徑** | **JPEG Base64（`downloadBase64`）** | 成功路徑直接回傳 `page.screenshot` → `toString("base64")`，避免 Storage 上傳／Signed URL、CORS 與跨網域下載鏈。 |
| **預熱機制** | **Hook：`useBattleCardCallablePrewarm`** | 登入後呼叫 `generateBattleCard({ prewarm: true })`：僅喚醒 Cloud Run 實例與程式載入，**不啟 Chromium**（後端對 `prewarm` 早退）。 |
| **併發** | **`concurrency: 1`**（此 Callable） | 單實例同時只跑一個 heavy Chromium job，降低記憶體與 `/dev/shm` 類型競態。 |
| **minInstances（此函式）** | **0** | 成本與冷啟取捨；依預熱與 180s 逾時補償體感。 |

**全域預設（其他 Callable）**：`setGlobalOptions` 仍為 **512MiB、60s、`minInstances: 1`**，與戰報卡專用設定**刻意分離**，避免「全專案拉到 2GiB／180s」或相反「戰報卡被全域 60s 掐死」。

---

#### 2. 多樣化技術路徑回顧（失敗與嘗試的血淚史）

##### 1）遠端爬取法（Puppeteer 開 `*.web.app` / Render Studio）

- **做法**：讓無頭瀏覽器 **navigate** 到已部署的 SPA（`RenderStudioPage` + 完整 `BattleCard` React 樹），再截圖。
- **痛點**：
  - **Vite 打包體與整站 hydration**：與「只輸出一張 1080×1080 圖」相比，載入與執行成本過高；冷啟動時首屏時間不穩定。
  - **App Check / 認證**：註解已明記 — 無頭頁面**無法可靠取得 App Check token**，在強制 App Check 下，客戶端 Firestore 讀取失敗，舊版無頭頁曾無法穩定設好 `__RENDER_READY__`。
  - **網路與依賴**：依賴 Hosting 線上資產、路由與第三方腳本；需額外攔截／等待策略。
- **結論**：改為 **`page.setContent` + `buildBattleCardVisualHtml` 內嵌全量 HTML**（與戰報卡視覺對齊），資料來源改為 **Callable 內讀 `profiles/{uid}` + 合併客戶端覆寫欄位**，不再依賴遠端 SPA 渲染鏈。

##### 2）閹割視覺實驗（縮減 CSS 換速度）

- **嘗試**：刪減漸層、字牆、backdrop-filter、多層陰影等，以縮短 layout／paint。
- **失敗現象**：畫面與 App 內 `BattleCard`／匯出場景**質感不一致**（「競技場張力」下降），屬於產品層不可接受。
- **教訓**：速度優化改走 **雲端記憶體／逾時／DPR／攔截追蹤腳本**，而非犧牲與前端對齊的視覺語言；後端 `battleCardVisualHtml.js` 明確定位為「**全量視覺 SSR**」。

##### 3）儲存鏈結游擊戰（Firebase Storage、IAM、CORS、Signed URL）

- **嘗試方向**：後端上傳截圖至 Storage，回傳 **download URL** 或 **Signed URL**，前端再 `fetch` 或 `<a download>`。
- **摩擦點**：
  - **IAM**：Cloud Functions 預設服務帳需具備 `storage.objects.create` 等；漏設或 bucket 不一致 → 上傳失敗。
  - **CORS**：瀏覽器從**非 Hosting 網域**或特殊 WebView 環境拉取時，若未與專案慣例一致設定 CORS，會出現跨域阻擋（專案另有 `docs/STORAGE-CORS-SETUP.md` 記載流程）。
  - **Signed URL**：時效、Content-Type、與快取標頭若未統一，除錯成本高；且多一跳網路與權限面。
- **結論**：主路徑改為 **Callable 直接回傳 Base64**；前端 `BattleCardExportScene` 仍保留 `downloadUrl`／`url` fallback 以相容舊回應，但**優先 Base64 本地組 Blob 下載**。

##### 4）心理補償戰術（i18n 兩段式文案）

- **第一段**（`loadingRenderStudio`）：強調「雕琢／1080p 質感」（zh-TW：`正在為您雕琢 1080P 極致質感戰報...`；en：`Crafting your 1080p battle report…`）。
- **第二段**（約 7 秒後切換 `loadingVerdictGrace`）：明講 **冷啟可能 1–3 分鐘、請勿關閉頁面**（zh-TW／en 見 `common.json`）。
- **設計原委**：SSR 體感延遲不只來自「算圖」，還來自 **Cloud Run 冷啟 + Chromium 啟動**；若只顯示「精美」文案，使用者會在 60s 內判定當機。第二段是**預期管理**，與後端 180s 及前端 `httpsCallable(..., { timeout: 200_000 })` 對齊。

##### 5）旗標戰爭（Chromium / @sparticuz/chromium）

實際 **`launch` 參數**來自 `puppeteer.defaultArgs({ args: chromium.args, headless: "shell" })` 與 `@sparticuz/chromium` 內建清單，並非在業務專案內逐行寫死。重點如下：

- **曾踩雷／已修正**：
  - **`headless` 模式不一致**：若 `chromium.headless` 為 `undefined`，Puppeteer 可能套用 `--headless=new`，與 **chrome-headless-shell** 及套件預設衝突 → 現象 **`Target closed`**（見註解與第 3 節）。
  - **現行強制**：`headless: "shell"` + 合併 `chromium.args`。
- **`chromium.setGraphicsMode = false`**：關閉 WebGL 路徑，避免不必要 GPU／SwiftShader 解壓；註解說明 **DPR=2 易 OOM**，故 viewport 使用 **`deviceScaleFactor: 1`**。
- **套件內常見旗標（節錄，實際以依賴版本為準）**：
  - `--single-process`、`--no-sandbox`、`--no-zygote`、`--headless='shell'`
  - 圖形開啟時：`--use-gl=angle`、`--use-angle=swiftshader`、`--enable-unsafe-swiftshader`；關閉圖形時改 `--disable-webgl`
  - 其他：`--disable-features=...site-per-process...`、`--in-process-gpu`、`--ignore-gpu-blocklist` 等
- **文獻或實驗中曾討論、未必在現行專案啟用**的旗標（供排查參考）：
  - `--disable-dev-shm-usage`（Linux 上減輕 `/dev/shm` 壓力；**Serverless 是否需加視執行環境**）
  - `--use-gl=swiftshader`（與套件採用的 **ANGLE + SwiftShader** 組合不同語意，混用時需驗證）
  - `--force-color-profile=srgb`（色彩一致性實驗；需與截圖管線一併評估）

---

#### 3. 穩定性陷阱與排雷紀錄（Post-mortem）

##### `Target closed`（共享記憶體／程序窒息）

- **觸發情境**：Chromium 在 **記憶體受限** 或 **程序／headless 旗標不一致** 時，瀏覽器目標提前終止，Puppeteer 操作頁面即拋 `Target closed`。
- **專案內因**：
  - **headless 與 binary 衝突**（已於 `index.js` 註解說明並改 `headless: "shell"`）。
  - **高 DPR / 高解析截圖** 放大記憶體峰值；註解明確寫 **DPR=2 易在雲端 OOM**，故採 **`deviceScaleFactor: 1`** + JPEG `quality: 95`。
  - `@sparticuz/chromium` 內建 **`--single-process`** 等 serverless 向旗標；若再疊加不當實驗旗標，可能加劇不穩定。

##### `500: Internal Error`（Storage 權限與 Module import 衝突）

- **語意**：前端 `BattleCardExportScene` 將 `internal` 對應為「後端渲染引擎崩潰」類診斷。
- **常見根因**：
  - **Puppeteer 執行期例外**：任何未預期的 `throw` 會被包成 `HttpsError("internal", ...)`（訊息含「後端渲染崩潰」）。
  - **動態載入**：`await import("./battleCardVisualHtml.js")` 若打包／部署路徑錯誤，可能導致 **Visual Engine Missing** 或載入失敗。
  - **歷史路徑**：若曾依賴 **Storage 上傳** 或 **錯誤的 IAM**，會在「上傳階段」失敗；現行主路徑已改 **Base64**，此類錯誤應顯著減少。

##### `DEADLINE_EXCEEDED`（冷啟動與「誰先斷線」）

- **機制**：Firebase Callable 客戶端若未設定足夠逾時，會在**閘道／SDK 層**先收到 `deadline-exceeded`，體感為「**還沒等到後端跑完就斷**」。
- **專案對策**：
  - 雲端函式 **180s**；前端 **`httpsCallable(..., { timeout: 200_000 })`**，**刻意長於**雲端逾時，並在註解說明：否則客戶端先 deadline、**504 不帶 CORS** 等除錯地獄。
- **「30 秒生死線」**（營運向說法）：  
  - 多數**預設** HTTP／Callable 客戶端或舊版全域 **60s** 與「冷啟 + Chromium + networkidle0」不相容時，**未調整的一方**會先超時；若曾使用 **全域 60s** 覆蓋戰報卡，會在 60s 內終止。  
  - 實際數字以 **現行程式碼**：函式 **180s**、客戶端 **200s** 為準。

---

#### 4. 技術債清償紀錄

| 項目 | 狀態 |
|------|------|
| **`render_jobs` 寫入** | **已自 `generateBattleCard` 主路徑移除**；不再依賴「建立 job → 無頭頁讀 Firestore → 渲染」的鏈條。 |
| **`getRenderStudioPayload`** | **仍保留** `render_jobs/{jobId}/tokens/{token}` 的 **Admin／HTTP 讀取**，供**手動除錯、舊連結、OTT**；**規則見 `firestore.rules`**（路徑即權杖策略）。 |
| **Client-side Payload 依賴（主路徑）** | **已替換**：身分／立場以 **`profiles`** 為準；客戶端僅**覆寫顯示欄位**（與 `mergeBattleCardSsrPayload` 一致），不再要求無頭頁自行讀 Firestore。 |
| **Storage 公開 URL 作為戰報卡主交付** | **已不採用為主路徑**；改 **Base64**；Storage 相關摩擦（IAM／CORS／Signed URL）降為歷史或次要路徑。 |

---

#### 5. 未來維護與擴展指引

##### 字體物理覆蓋路徑

- **Hosting 上**：字體須與 **`public/fonts/GOAT-Display.ttf`** 一致，部署後 URL 為 **`{BATTLE_CARD_HOSTING_ORIGIN 或預設 projectId.web.app}/fonts/GOAT-Display.ttf`**（見 `battleCardVisualHtml.js` 中 `resolveHostingOrigin` 與 `fontUrl`）。
- **若改網域或自架 CDN**：必須同步 **`BATTLE_CARD_HOSTING_ORIGIN` / `RENDER_STUDIO_BASE_URL`**，否則 `@font-face` 404 會回退系統字，**與 App 字重不一致**。

##### `deviceScaleFactor: 2` 的運算成本評估

- **現行**：`setViewport` 使用 **`deviceScaleFactor: 1`**，註解明確：**DPR=2 易 OOM**。
- **若未來要升 2**：預期 **記憶體與截圖像素量約×4 級**壓力；需同步評估 **函式記憶體上限**、**單實例併發**、以及 **JPEG quality** 是否可略降以抵銷。

##### `minInstances` 的動態調整條件（何時從 0 改為 1）

- **維持 0 的適用情境**：流量低、可接受 **冷啟 1–3 分鐘**首包、且已用 **prewarm Hook + 文案預期管理**。
- **建議改為 1 的訊號**：
  - 營運活動期間 **SSR 呼叫量**明顯上升，且 **P95 延遲**或 **客訴「超時」**集中出現在冷啟。
  - **成本可接受**且希望 **首包時間穩定**（避免 Boss／媒體測試時「第一次必失敗」）。
  - 注意：僅調整 **`generateBattleCard` 的 `minInstances`**，勿與全域 `setGlobalOptions` 混淆；並在 Console 確認 **Cloud Run 服務**對應函式之最小執行個體。

---

**文件版本**：與 repo 內 `functions/index.js`、`functions/battleCardVisualHtml.js`、`src/hooks/useBattleCardCallablePrewarm.js`、`src/pages/BattleCardExportScene.jsx` 一致時有效；若程式碼變更，請同步更新本文件。
