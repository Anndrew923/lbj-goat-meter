# Firebase 讀取量優化審查（LBJ GOAT Meter）

> 審查日期：2026-02-17。針對單人測試 3000+ Reads 異常進行優化與診斷加固。

---

## 1. 監聽器清理 (Listener Cleanup)

### 審查結果

| 位置 | 類型 | 清理方式 | 備註 |
|------|------|----------|------|
| **AuthContext.jsx** | `onSnapshot(profiles/{uid})` 單一 Document | ✅ `return () => { profileUnsubscribeRef.current?.(); unsubscribe(); }` | 登出 / uid 變更時會清理；冷卻計時器一併 clearTimeout |
| **useSentimentData.js** | `onSnapshot(query(votes, ...))` Collection 查詢 | ✅ `return () => { clearTimeout(timeoutId); unsubscribe(); }` | 依賴變更或卸載時會 unsubscribe |
| **LiveTicker.jsx** | `onSnapshot(query(votes, orderBy, limit(10)))` Collection 查詢 | ✅ `return () => { clearTimeout(timer); unsubRef.current?.(); }` | 組件卸載時清理 |

**結論**：所有 `onSnapshot` 均有對應的 `return () => unsubscribe()`，無殘留監聽器。

### 單 Document vs Collection

- **單一 Document 監聽**（Read 成本低）：僅 **AuthContext** 的 `profiles/{uid}`。
- **Collection 查詢監聽**（每次訂閱 = 查詢結果的 Listener，變動時會觸發 Reads）：
  - **useSentimentData**：`votes` 依 starId + filters + limit 查詢，被 SentimentStats、AnalyticsDashboard、PulseMap 等多處使用，**每處掛載 = 一組獨立 Listener**。
  - **LiveTicker**：`votes` 最近 10 筆。

若同一頁面有多個組件使用 `useSentimentData`（且 filters 可能相同），建議後續可考慮上層共用一筆 data（例如 Context 或單一 Hook 再分發），以減少重複訂閱。

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
| **AuthContext** | `Firebase Fetching [AuthContext fetchIsPremium] profiles/{uid}`（getDoc 時） |
| **AuthContext** | `Firebase Fetching [AuthContext onSnapshot] profiles/{uid} (單一 Document 監聽)`（訂閱建立時） |
| **useSentimentData** | `Firebase Fetching [useSentimentData] votes 查詢訂閱 (Collection query)` |
| **LiveTicker** | `Firebase Fetching [LiveTicker] votes 查詢訂閱 (Collection query, limit 10)` |
| **BattleCardContainer** | `Firebase Fetching [BattleCardContainer] warzoneStats/{warzoneId}`（getDoc 時） |

**使用方式**：以開發模式進入 `/vote` 等頁面，觀察 Console 中上述 Log 的出現次數與時機；若同一邏輯在短時間內出現多次，即表示可能有重複掛載或依賴變動導致重複訂閱，需再檢查父組件與依賴陣列。

---

## 後續建議（可選）

1. **共用 votes 查詢結果**：若 SentimentStats、AnalyticsDashboard、PulseMap 常以相同 filters 出現在同一頁，可改為上層一次 `useSentimentData`，再透過 Context 或 props 分發，減少同時存在的 Listener 數量。
2. **聚合文件**：若產品允許，可考慮由 Cloud Functions 維護「全球／篩選後」的聚合文件（例如 `aggregates/sentimentGlobal`），前端改為監聽單一 Document，進一步降低 Collection 查詢的 Reads。
3. **warzoneStats**：BattleCardContainer 目前為 `getDoc` 單次讀取，若未來改為 onSnapshot，仍建議只監聽單一 `warzoneStats/{id}`，並在關閉 Modal 或切換戰區時 unsubscribe。
