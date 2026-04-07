# Firestore Rules 路線 A 維運手冊（含回滾對照）

本文件整理目前 `lbj-goat-meter` 採用的「路線 A」安全策略：

- 公開資料：允許匿名/未登入使用者讀取（確保首屏與觀察者體驗穩定）
- 敏感資料：維持使用者身份或後端唯一寫入
- 所有核心寫入仍由 Cloud Functions Admin SDK 控制

---

## 1) 路線 A 目標與原則

### 目標

- 確保匿名觀察者可穩定載入：
  - 全球統計
  - 地圖資料
  - 突發戰區內容
- 避免 App Check / Auth 時序抖動造成前端全面 `permission-denied`

### 原則

- **讀取分級**：公開統計可公開讀；個資與使用者私有資料維持受限
- **寫入封鎖**：前端不直接寫核心集合，統一走後端 Callable + Transaction
- **可回滾**：保留嚴格版 read 條件，必要時可快速切回

---

## 2) 路線 A 現行規則矩陣（建議長期維運）

| Collection | Read | Write | 說明 |
|---|---|---|---|
| `warzoneStats/{statsId}` | 公開 (`true`) | 禁止 (`false`) | 全球/戰區統計供全站訪客瀏覽 |
| `global_events/{eventId}` | 公開 (`true`) | 僅 Admin create/delete；update 限 `is_active/updatedAt` | 突發戰區內容公開，維持後台控管 |
| `global_events/{eventId}/votes/{deviceId}` | 公開 (`true`) | 禁止 (`false`) | 前端可讀投票結果，不可改寫 |
| `analytics_pro/{cacheKey}` | 已登入 (`isAuthenticated`) | 禁止 (`false`) | 避免 analytics 快取被任意掃描 |
| `profiles/{userId}` | 僅本人 (`isOwner`) | 僅本人 (`isOwner`) | 使用者資料 |
| `profiles/{userId}/breaking_votes/{eventId}` | 僅本人 (`isOwner`) | 禁止 (`false`) | 突發戰區個人投票存證 |
| `votes/{voteId}` | 僅本人且比對 `resource.data.userId` | 禁止 (`false`) | 主投票資料不開放全集合掃描 |
| `device_locks/{deviceId}` | 已登入 | 禁止 (`false`) | 由後端維護防重機制 |

---

## 3) 路線 A 關鍵規則片段（現行）

> 來源：`firestore.rules`

```rules
// 4. 戰區統計：路線 A（公開只讀）— 大盤資料對所有訪客開放讀取，寫入仍僅後端 Transaction。
match /warzoneStats/{statsId} {
  allow read: if true;
  allow create, update, delete: if false;
}

// 5. 專業分析數據：維持已登入可讀，避免公開掃描 analytics cache。
match /analytics_pro/{cacheKey} {
  allow read: if isAuthenticated();
  allow create, update, delete: if false;
}

// 6. 突發戰區（global_events）：路線 A（公開只讀）— 內容可公開瀏覽；主文件仍僅管理員可建/刪，update 僅限 is_active+updatedAt。
match /global_events/{eventId} {
  allow read: if true;
  allow create, delete: if isBreakingWarzoneAdmin();
  allow update: if isBreakingWarzoneAdmin() && isBreakingGlobalEventAdminOnlyMetaUpdate();
}

// 7. 突發戰區子集合 votes：路線 A（公開只讀）— 結果可公開讀；前端不可直接改寫
match /global_events/{eventId}/votes/{deviceId} {
  allow read: if true;
  allow create, update, delete: if false;
}
```

---

## 4) 嚴格版回滾對照（read 收回需登入）

若需回滾到舊策略（讀取要求登入/匿名 Auth），只需把以下片段中的 `read` 條件改回：

```rules
match /warzoneStats/{statsId} {
  allow read: if isAuthenticated();
  allow create, update, delete: if false;
}

match /analytics_pro/{cacheKey} {
  allow read: if isAuthenticated();
  allow create, update, delete: if false;
}

match /global_events/{eventId} {
  allow read: if isAuthenticated();
  allow create, delete: if isBreakingWarzoneAdmin();
  allow update: if isBreakingWarzoneAdmin() && isBreakingGlobalEventAdminOnlyMetaUpdate();
}

match /global_events/{eventId}/votes/{deviceId} {
  allow read: if isAuthenticated();
  allow create, update, delete: if false;
}
```

---

## 5) 發布與回滾 SOP

### 發布（套用當前 `firestore.rules`）

```bash
npx firebase deploy --only firestore:rules
```

### 回滾流程

1. 將 `firestore.rules` 的目標段落改為上方「嚴格版回滾對照」
2. 執行部署：
   ```bash
   npx firebase deploy --only firestore:rules
   ```
3. 立即驗證：
   - 匿名進入 `/vote` 是否被限制（預期：可能讀不到公開區塊）
   - 已登入用戶是否可正常載入

---

## 6) 上線後驗證清單（路線 A）

- 匿名使用者：
  - `/vote` 可載入全球統計、地圖、突發戰區
  - `/breaking-history` 不出現 `Missing or insufficient permissions`
- 已登入使用者：
  - 同頁面資料正常
  - 投票/重置/突發投票流程正常（由 Functions 控制）
- 安全性：
  - 前端仍無法直接寫入 `warzoneStats`、`votes`、`global_events/*/votes`

---

## 7) 維運建議

- 若未來要再啟用更嚴格策略，建議採灰度：
  - 先 `Monitor` 再 `Enforce`
  - 先保護寫入路徑，再評估是否收緊公開讀取
- 保留本文件作為 incident runbook，避免再次出現「只見通用錯誤文案、難以定錨」的排查成本。

