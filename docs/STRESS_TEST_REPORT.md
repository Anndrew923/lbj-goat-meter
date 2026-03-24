# 萬人級併發壓力測試報告（KPI 範本）

優化完成後請依實際跑測結果填寫下列欄位，並保留指令與環境版本（Node、Functions 世代、專案 ID）。

---

## Supernova 部署後紀錄（2026-03-24）— **已上線**

**專案**：`lbj-goat-meter`（`us-central1`）

### 已執行動作

| 步驟 | 結果 |
|------|------|
| `GOAT_FINGERPRINT_PEPPER` | 已寫入 Secret Manager（version 1）；`submitVote` 以 `defineSecret` + `onCall({ secrets })` 綁定，部署時已自動授予 `secretAccessor` |
| Firestore | `firebase deploy --only firestore:indexes,firestore:rules --force` 已成功。**注意**：`--force` 曾刪除 **2 個** 未列於 `firestore.indexes.json` 的遠端索引；若舊查詢異常，請至 Console 依錯誤連結補回索引 |
| Functions | 已刪除 1st Gen Callable（`submitVote`、`resetPosition`、`deleteUserAccount`、`submitBreakingVote`、`issueAdRewardToken`）後，成功建立 **2nd Gen** 同名 Callable + 更新既有 v1 觸發器 |
| 程式碼 | `hashDeviceFingerprintMaterial` 支援 Secret 注入之 `explicitPepper` |

### Gen2 Callable 執行個體設定（驗證）

| 檢查項 | 驗證方式 | 結果 |
|--------|----------|------|
| Memory | `npx firebase-tools functions:list`（MiB 欄） | **512**（六支 v2 Callable 皆為 512） |
| timeout | `functions/index.js` → `setGlobalOptions({ timeoutSeconds: 60 })` | **60s**（與原始碼一致；若需 Console 截圖請至 **Cloud Run** 對應服務覆核 `Timeout`） |
| minInstances | `setGlobalOptions({ minInstances: 0 })` | **0**（冷啟動允許；Console **Cloud Run → 最小執行個體** 應為 0） |
| concurrency | `CALLABLE_HTTP_OPTS` | **64** |

### A. Callable 延遲 — **實測（HTTP 煙霧，非完整業務鏈）**

**方法**：對 `https://us-central1-lbj-goat-meter.cloudfunctions.net/<name>` 連續 `POST` JSON `{"data":{...}}`，**未帶 Firebase ID Token**（後端快速回 `unauthenticated`）。量到的是 **TLS + 區域往返 + Gen2 拒絕未授權** 的延遲，**低於** 真實 `submitVote`（reCAPTCHA + Transaction）之上限。

| 函式 | 樣本數 n | P50 (ms) | P95 (ms) | 備註 |
|------|----------|----------|----------|------|
| submitVote | 20 | 286 | 391 | 未授權短路；正式投票請另以帶 Token 之 k6 量測 |
| getFilteredSentimentSummary | 20 | 292 | 481 | 同上；首個樣本常含冷啟動偏髙 |
| resetPosition | 12 | 289 | 412 | |
| deleteUserAccount | 12 | 303 | 409 | 方案 B 完整路徑需已登入 + 真刪流程 |
| issueAdRewardToken | 12 | 287 | 442 | |
| submitBreakingVote | 12 | 284 | 447 | |

**後續**：請以 **有效 ID Token** 對 `submitVote` / `getFilteredSentimentSummary` 跑 k6，並將「業務成功路徑」之 P50/P95 覆寫上表。

### B. Firestore Transaction 衝突率

| 情境 | 狀態 |
|------|------|
| 同戰區密集 submitVote | **本次未執行併發壓測**；請以 k6 + Cloud Logging（`ABORTED` / `FAILED_PRECONDITION`）補數 |
| 同 uid 重複投票 | 同上 |

**建議工具**：k6、`artillery`、或自訂腳本對 Callable HTTPS 端點發送；需先以 Firebase Auth 換取 ID Token 並帶入 `Authorization: Bearer <idToken>`。

## C. 投票 + 方案 B（刪帳／重置）交錯一致性

- **驗證方式**：在 Staging 以腳本交替呼叫 `submitVote` / `resetPosition` / `deleteUserAccount`，結束後比對 `warzoneStats/global_summary` 與 `warzoneStats/{warzoneId}` 之 `totalVotes`、各立場計數是否與 `votes` 集合筆數（Admin 匯出或 BigQuery）一致。
- **零值**：確認 `reasonCounts*`、`countryCounts`、戰區計數經扣減後不為負數。

## 環境變數（後端）

- `GOAT_FINGERPRINT_PEPPER`：已透過 **Secret Manager** 管理；`submitVote` 執行期由 Firebase 掛載至 `defineSecret().value()`。

## 區域

- Callable：**us-central1**；前端請設定 `VITE_FIREBASE_FUNCTIONS_REGION=us-central1`（若與後端 `FUNCTIONS_REGION` 變更需同步）。

---

**萬人防線狀態**：後端 Gen2、規則、索引、指紋 Secret 與程式綁定已部署；**併發衝突率與「已登入」完整延遲**仍待 Boss 指定檔期跑 k6 後更新本檔。
