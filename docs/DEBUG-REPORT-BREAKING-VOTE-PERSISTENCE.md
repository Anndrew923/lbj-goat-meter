# 突發戰區投票狀態丟失 — 除錯總結報告（存查）

本文為「突發戰區投票後切換分頁／返回首頁導致票數歸零或結果條消失」問題的完整除錯記錄與最終解法，供存查與回歸測試參考。

**除錯時間區間**：約 2026-03-18。  
**相關功能**：突發戰區（global_events）投票、首頁 Banner、歷史話題頁（/breaking-history）、BreakingVoteContext、useGlobalBreakingEvents。

---

## 一、問題現象

- 使用者在首頁對突發話題完成投票後，畫面正確顯示「已記錄您的選擇」與結果條（100%／1 票）。
- 切換至「突發戰區」或「歷史話題」分頁時，該話題在歷史頁仍顯示為已投票，行為正常。
- **返回首頁後**：同一則突發話題的投票結果消失，畫面回到「可投票」按鈕或結果條顯示 0 票。
- 部分情境下「撐比較久」才丟失（例如先切回首頁正常，再切到歷史話題後再回首頁才丟失）。

---

## 二、根因分析

### 2.1 狀態來源與生命週期

- **votedEventIds**：記錄「已投過的話題 eventId 列表」，存於 `localStorage`（`lbj_breaking_voted`）並在組件初始化時讀取。
- **lastVoted**：樂觀狀態 `{ eventId, optionIndex, timestamp }`，用於在 Firestore 尚未回傳 `total_votes` 前顯示至少 1 票；存於 `localStorage`（`lbj_breaking_last_voted`），TTL 60 秒。

問題在於：

1. **僅依賴組件掛載時讀取 localStorage**  
   從戰區返回首頁時，VotePage / UniversalBreakingBanner 重新掛載，若讀取時機或 key 不一致，會導致「已投」狀態遺失。

2. **過早清除 lastVoted**  
   當任一頁面（首頁或歷史頁）的 `useGlobalBreakingEvents` 收到一筆「該活動 total_votes > 0」的 snapshot 時，若在該頁面呼叫 `clearLastVoted()`，會清掉 Context 與 localStorage 的 lastVoted。  
   返回另一頁時，該頁的訂閱可能仍拿到**舊快取**（total_votes: 0）。此時 lastVoted 已被清掉，無法再做樂觀補正，畫面遂顯示 0 票。

3. **兩頁訂閱不同 query，快取不同步**  
   首頁訂閱：`is_active === true`、limit 5。  
   歷史頁訂閱：`includeInactive: true`、limit 50。  
   兩邊快取更新時序不一致時，會出現「一邊已看到 server 票數並清除 lastVoted，另一邊仍為 0」的狀況。

### 2.2 驗證方式（Console 日誌）

除錯過程中加入 DEV 專用 log（僅 `import.meta.env.DEV` 時輸出）：

- `[BreakingVote] markEventVoted`：投票當下寫入 Context。
- `[useGlobalBreakingEvents] snapshot`：每次 snapshot 的 listLength、lastVotedEventId、targetTotalVotes、targetVoteCounts。
- `[useGlobalBreakingEvents] 略過空快照，等待有資料`：空列表且存在 lastVoted 時不覆寫 events，避免 banner 消失。
- `[useGlobalBreakingEvents] 補正樂觀票數`：對 total_votes === 0 的活動以 lastVoted 補 1 票。
- `[UniversalBreakingBanner] 清除 lastVoted` / `[BreakingHistoryPage] 清除 lastVoted`：因 total_votes > 0 而清除樂觀狀態（此行為已於最終版移除）。

透過上述 log 確認：在歷史頁因收到 total_votes: 1 而清除 lastVoted 後，返回首頁時首筆 snapshot 常為 total_votes: 0，且因 lastVoted 已空無法補正，導致票數歸零。

---

## 三、最終解法（穩定版）

### 3.1 設計原則

- **「是否已投票」與「伺服器統計數字」解耦**  
  已投狀態以 Context + localStorage（及後端 device 限制）為準，不因某次 Firestore snapshot 的 total_votes 變動而改變。
- **結果條數字**：以「伺服器數據 + 樂觀補正」呈現；若 server 為 0 但本機有 lastVoted，則至少顯示 1 票，避免歸零。
- **lastVoted 僅依 TTL 過期**  
  不再因「看到 total_votes > 0」而主動清除 lastVoted，避免跨頁快取不同步時導致另一頁無法補正。

### 3.2 具體變更

| 項目 | 說明 |
|------|------|
| **BreakingVoteContext** | 集中管理 votedEventIds、lastVoted、markEventVoted；寫入時同步更新 localStorage；不再對外提供「因 server 票數而清除」的呼叫時機。 |
| **lastVoted 清除策略** | 僅在讀取時檢查 TTL（60 秒），過期則視為無效並自 localStorage 移除；**首頁與歷史頁皆不再**因 snapshot 的 total_votes > 0 呼叫 clearLastVoted()。 |
| **UniversalBreakingBanner** | 移除「當 Firestore 回傳該活動 total_votes > 0 時呼叫 clearLastVoted()」的 useEffect；已投與結果條完全依 Context 與 hook 補正。 |
| **BreakingHistoryPage** | 移除「當該活動 total_votes > 0 時呼叫 clearLastVoted()」的 effect，避免在歷史頁清除後導致返回首頁時無法補正。 |
| **useGlobalBreakingEvents** | 保留：空 snapshot 且存在 lastVoted 時不覆寫 events（略過空快照）；對 total_votes === 0 且存在 lastVoted 的活動做樂觀補正（total_votes: 1、對應選項 +1）。 |
| **BreakingOptionResultBars** | 維持既有邏輯：totalVotes === 0 且有 optimisticOptionIndex 時以 1 票顯示；有 server 數據時以 server 為準。 |

### 3.3 新增／修改的檔案一覽

- **新增**
  - `src/utils/breakingVoteStorage.js`：集中管理 `lbj_breaking_voted`、`lbj_breaking_last_voted` 的讀寫與 TTL、loadLastVotedSafe（供 hook 補正用）。
  - `src/context/BreakingVoteContext.jsx`：Provider 包住 Routes，提供 votedEventIds、lastVoted、markEventVoted；初始化自 localStorage，寫入時同步持久化。
- **修改**
  - `src/App.jsx`：以 BreakingVoteProvider 包住 Routes，使投票狀態在路由切換時不卸載。
  - `src/hooks/useGlobalBreakingEvents.js`：自 breakingVoteStorage 引入 loadLastVotedSafe；空快照略過邏輯；樂觀補正邏輯；DEV 用 snapshot / 補正 log。
  - `src/components/UniversalBreakingBanner.jsx`：改為使用 useBreakingVote()，移除 clearLastVoted 及「因 total_votes > 0 清除」的 useEffect。
  - `src/pages/BreakingHistoryPage.jsx`：改為使用 useBreakingVote()，移除 clearLastVoted 及「因 total_votes > 0 清除」的 effect。
  - `functions/index.js`（前期）：runSubmitBreakingVote 改為以 `set(..., { merge: true })` 更新 global_events 文件，確保 vote_counts / total_votes 欄位存在時仍可正確 increment。

---

## 四、後端與成本備註

- **Cloud Functions**  
  submitBreakingVote 以 Transaction 寫入 `global_events/{eventId}`（vote_counts、total_votes、updatedAt）與 `global_events/{eventId}/votes/{deviceId}`，寫入次數固定，無額外膨脹。
- **Firestore 讀取**  
  WarzoneDataContext 僅監聽 `warzoneStats/global_summary`；useGlobalBreakingEvents 監聽 global_events 的條件查詢並限制筆數，無重複監聽同一資料，成本可控。
- **Storage**  
  breakingVoteStorage 僅使用 localStorage，未增加 Firebase Storage 使用。

---

## 五、回歸測試檢查表

建議在每次改動突發戰區或 Context 後執行：

1. 首頁對一則突發話題投票，確認出現「已記錄您的選擇」與結果條（至少 1 票）。
2. 點「查看所有歷史話題」進入歷史頁，確認該話題顯示為已投票且有結果條。
3. 返回首頁，確認同一話題仍為已投票且結果條未歸零。
4. 再次進入歷史話題後再返回首頁，確認結果仍存在（60 秒內）。
5. （可選）重新整理首頁，確認 60 秒內仍顯示已投狀態；60 秒後僅依 server 數據，且不會出現可重複投票。

---

## 六、參考文件

- 突發戰區與管理後台功能總結：`docs/SUMMARY-BREAKING-ARENA-AND-ADMIN.md`
- 專案開發規範：`.cursorrules`（GOAT Meter: LeBron）

---

## 七、後記：這類錯誤在實戰中的頻率與除錯心法

### 7.1 是否常見？

在實戰專案裡，**「單票有紀錄、統計沒更新／沒顯示」其實相當常見**，尤其是同時具備以下特徵時：

- 同一套資料有「**紀錄層**」與「**統計層**」（例如 votes 子集合 vs warzoneStats/global_events 聚合欄位）。
- 前端有做「**樂觀更新 + 本機快取**」，讓短時間內畫面看起來是對的，但掩蓋了後端統計沒更新的事實。
- 有 **多個環境／Emulator／管理端工具** 同時在寫資料，容易發生「這裡 +1、那裡 set 回 0」的衝突。

本次問題幾乎踩滿所有地雷：

1. `global_events/{eventId}/votes/{deviceId}` 與 `global_events/{eventId}` 的 `total_votes/vote_counts` 分離。  
2. 首頁與歷史頁各有一個 `onSnapshot` 訂閱，query 條件不同，快取時序不一致。  
3. 前端一開始以 `total_votes` 判斷「是否已投」，而非以 vote 紀錄／Context 為準。  
4. 後端曾經用不一致的寫法更新 `vote_counts`，導致出現 `\"'0'\"` 這種歷史壞 key，前端只讀 `"0"`，自然永遠顯示 0%。  

這也是為什麼這次除錯需要同時看：Cloud Functions、Firestore Console、前端 hook、Context、localStorage 與 Network／Logs Explorer，才能把整條鏈路真正走完。

### 7.2 之後遇到類似問題的快速排查順序

若未來在其他專案遇到「後端記錄存在，但統計或 UI 顯示怪怪的」，可以優先照以下順序排查（本次已驗證有效）：

1. **Firestore Console：先看「最後真相」**  
   - 確認紀錄層（如 `votes/{id}`）是否存在。  
   - 確認統計層（如 `total_votes` / `vote_counts`）是否有正確加總。  
   - 若紀錄有、統計沒 → 優先修 Functions 或任何會覆寫統計的程式。  

2. **Callable Response：把統計一併回傳**  
   - 在 Cloud Function 結尾多讀一次該 doc，回傳 `total_votes/vote_counts/debug`。  
   - 投票成功後直接在 Network → Response 確認統計是否已更新，免得在 Console 與前端之間來回切。  

3. **前端：把「是否已投」與「統計數字」解耦**  
   - 「已投狀態」：只看 Context / device lock / vote doc，不看 `total_votes`。  
   - 統計顯示：允許慢一點或暫時不準，但永遠不能推翻「已投」這個事實。  

4. **快取與多訂閱：只在必要處加樂觀護欄**  
   - 空快照或舊快照時，若本機知道剛投過，就用樂觀值補上，直到伺服器統計到位。  
   - 避免在多個頁面／多個 query 看到 `total_votes > 0` 就到處清掉樂觀狀態，容易與快取時序打架。  

掌握這四步，之後不論在哪個專案遇到「票有寫、圖不對」這類問題，都可以用相似的路線快速定位與修復。

---

*報告結束*
