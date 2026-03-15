# Firebase 讀取量優化審查（LBJ GOAT Meter）

> 審查日期：2026-02-17。針對單人測試 3000+ Reads 異常進行優化與診斷加固。

---

## 1. 監聽器清理 (Listener Cleanup)

### 審查結果（優化後）

| 位置 | 類型 | 清理方式 | 備註 |
|------|------|----------|------|
| **AuthContext.jsx** | `onSnapshot(profiles/{uid})` 單一 Document | ✅ `return () => { profileUnsubscribeRef.current?.(); unsubscribe(); }` | 登出 / uid 變更時會清理；冷卻計時器一併 clearTimeout |
| **WarzoneDataContext.jsx** | `onSnapshot(warzoneStats/global_summary)` 單一 Document | ✅ `return () => { unsubRef.current?.(); unsubRef.current = null; }` | 投票頁唯一聚合監聽，卸載時徹底 unsubscribe |
| **useSentimentData.js** | `getDocs(query(votes, ...))` + useBarometerQuery | ✅ 無 Listener；useEffect return 內 `cancelled = true` + clearTimeout(debounceTimerRef) | 單次查詢 + Session 快取，非 onSnapshot |
| **LiveTicker.jsx** | 無直接 Firestore 呼叫 | — | 數據來自 **WarzoneDataContext**（recentVotes），不另開 Listener |
| **BattleCardContainer.jsx** | `getDoc(warzoneStats/{id})` 單次讀取 | ✅ `return () => { cancelled = true }` | 已改為 getDoc + 60 秒記憶體快取，無 onSnapshot |

**結論**：所有 `onSnapshot` 均在 useEffect 的 cleanup 中被徹底 `unsubscribe()`；進入投票頁時「Firebase Fetching」Log 僅在初次掛載時各出現一次。

### 單一數據源（優化後）

- **GlobalSentimentContext**：votes 查詢由 **GlobalSentimentProvider**（SentimentDataProvider 委派）單一呼叫 `useSentimentData`，SentimentStats、AnalyticsDashboard、PulseMap 透過 `useSentimentDataContext()` 消費，**三組件同時掛載 = 1 次 votes 相關請求**。
- **WarzoneDataContext**：`warzoneStats/global_summary` 唯一 onSnapshot，LiveTicker 與大盤數據皆由此分發。
- **BattleCardContainer**：`warzoneStats/{id}` 改為單次 getDoc + 60 秒快取，同一戰區重複開啟不重打 Reads。

---

## 2. 交易邏輯優化 (Transaction Audit)

### 審查結果：先讀後寫均符合規範

| 檔案 | 函式 | 順序 |
|------|------|------|
| **PaymentService.js** | `simulatePurchase` | `tx.get(profileRef)` → `tx.update(profileRef)` ✅ |
| **AccountService.js** | `revokeVote` | 階段一：`tx.get(profileRef)`、`tx.get(voteRef)`；階段二：`tx.update` / `tx.delete` / `tx.set` ✅ |
| **AccountService.js** | `deleteAccountData` | Transaction 外 `getDocs(voteQuery)` 取 id 列表；Transaction 內僅 `tx.get(profileRef)` 後 `tx.delete` ✅ |
| **VotingArena.jsx** | `handleSubmit` | 階段一：`tx.get(profileRef)`；階段二：`tx.set(newVoteRef)`、`tx.set(warzoneStatsRef)`、`tx.update(profileRef)` ✅ |

**結論**：所有 Transaction 均為「先完成所有 `tx.get()`，再進行寫入」，無「先寫後讀」或寫入後再 get，可避免無謂重試與報錯。

---

## 3. 緩存策略 (Persistence)

### 實作狀態

- **已開啟**：在 `src/lib/firebase.js` 中，於 `initializeFirestore` 之後呼叫 `enableIndexedDbPersistence(db)`。
- 不常變動的資料（如 `profiles/{uid}`、`warzoneStats/{id}`）會優先使用本地 IndexedDB 緩存，減少對伺服器的 Reads。
- 錯誤處理：
  - `failed-precondition`：另一分頁已啟用持久化，本分頁使用記憶體緩存。
  - `unimplemented`：瀏覽器不支援時僅記錄警告，不影響 App 運行。

---

## 4. 重複渲染 / 重複讀取診斷

### 已加上的診斷 Log（僅 DEV）

在下列讀取路徑加入 `console.log("Firebase Fetching [...]")`，方便確認進入頁面時是否觸發多次不必要的讀取：

| 位置 | Log 內容 |
|------|----------|
| **WarzoneDataContext** | `Firebase Fetching [WarzoneDataContext] warzoneStats/global_summary (唯一聚合監聽)`（onSnapshot 建立時） |
| **useSentimentData** | `Firebase Fetching [useSentimentData] votes 查詢 (getDocs + session cache)`（實際打 getDocs 時，Session 快取命中則不輸出） |
| **BattleCardContainer** | `Firebase Fetching [BattleCardContainer] warzoneStats/{warzoneId}`（getDoc 時；60 秒快取命中則不輸出） |

**使用方式**：以開發模式進入 `/vote` 等頁面，觀察 Console 中上述 Log 的出現次數與時機；**預期**：初次掛載時 WarzoneDataContext 與 useSentimentData 各 1 次，開啟戰報卡時 BattleCardContainer 每戰區首次 1 次，之後 60 秒內同戰區不再出現。

---

## 後續建議（可選）

1. ~~**共用 votes 查詢結果**~~ **已實作**：已建立 **GlobalSentimentContext**，SentimentStats、AnalyticsDashboard、PulseMap 經由單一 Provider 取得數據，votes 相關查詢僅 1 次。
2. **聚合文件**：若產品允許，可考慮由 Cloud Functions 維護「全球／篩選後」的聚合文件（例如 `aggregates/sentimentGlobal`），前端改為監聽單一 Document，進一步降低 Collection 查詢的 Reads。
3. ~~**warzoneStats**~~ **已優化**：BattleCardContainer 維持 `getDoc` 單次讀取，並加上 60 秒記憶體快取，同一戰區重複開啟不重複讀取。

---

## 5. 優化執行報告（Cost Efficiency First）

> 執行日期：依本輪加固完成時為準。

### 實作項目

| 項目 | 內容 |
|------|------|
| **單一數據源** | 新增 `src/context/GlobalSentimentContext.jsx`，將 votes 查詢集中於 GlobalSentimentProvider；`SentimentDataContext.jsx` 改為委派至 GlobalSentimentContext，維持既有 API。 |
| **監聽器清理** | 確認 WarzoneDataContext onSnapshot 在 useEffect cleanup 中 unsubscribe；LiveTicker 無獨立 Firestore 呼叫；BattleCardContainer getDoc 具 cancelled 清理。 |
| **warzoneStats 快取** | BattleCardContainer 對 `warzoneStats/{id}` 使用 getDoc + 60 秒記憶體快取，同一戰區 60 秒內重開不再發送 Reads。 |
| **診斷 Log** | useSentimentData、BattleCardContainer 已對齊「Firebase Fetching」Log，DEV 下可驗證初次掛載僅各 1 次。 |

### 進入投票頁面：Reads 估算（優化後）

| 讀取來源 | 優化前（估算） | 優化後 | 說明 |
|----------|----------------|--------|------|
| warzoneStats/global_summary | 1 (onSnapshot 建立) | 1 | 維持單一監聽，無變動 |
| votes 查詢（大盤／篩選） | **3**（SentimentStats + PulseMap + AnalyticsDashboard 各 1） | **1** | 改由 GlobalSentimentProvider 單一 useSentimentData，三組件共用 |
| warzoneStats/{id}（戰報卡） | 每次開啟 1 read | 每戰區 60 秒內僅首開 1 read | 60 秒快取 |

### Reads 減少百分比（進入投票頁面）

- **僅論「進入投票頁、三組件同時掛載」的 votes 相關讀取**：由 **3 次** 降為 **1 次** → **約減少 66.7%（2/3）**。
- **若先前還有 LiveTicker 獨立 votes 查詢**：當時為 4 次 votes 相關，現為 1 次 → **約減少 75%**。
- **戰報卡**：同一用戶短時間內重複打開同一戰區卡時，60 秒內重複讀取歸零，Reads 再降。

**結論**：進入投票頁面時，與 votes／大盤相關的 Firebase Reads 已壓縮為單一數據源分發，總 Reads 減少約 **66%～75%**（依優化前是否含 LiveTicker 獨立查詢而異）；戰報卡 warzoneStats 經 60 秒快取後，重複開啟同一戰區的 Reads 顯著下降。
