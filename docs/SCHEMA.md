# GOAT Meter — Firestore 數據模型與設計意圖

本文檔定義 Firestore 集合結構與索引策略，以支援「球隊派系 × 全球地理」的多維度漏斗過濾與後續橫向複製至其他球星。

---

## 1. 設計原則

- **球星維度抽離**：透過 `starId` 區分球星，同一套 Schema 可複用於不同球星專案（如 `"lbj"`、`"kd"`）。
- **平面化維度**：將年齡、性別、地理、球隊等維度以欄位形式寫入文件，避免巢狀結構，以便 Firestore `where()` 組合查詢與複合索引對應。
- **漏斗過濾友善**：查詢條件對應「全球 → 國家 → 城市」與「年齡 / 性別 / 球隊」的交叉篩選，符合 fitness-app 風格的層級過濾邏輯。

---

## 2. 集合定義

### 2.1 `votes` 集合

單筆文件代表一位用戶對某球星的一次情緒投票（GOAT / 黑 / 尊重 / 反派等）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 文件 ID（可為自動或業務生成） |
| `starId` | `string` | 球星識別，擴展位元，例：`"lbj"` |
| `userId` | `string` | 投票者 UID（Firebase Auth） |
| `status` | `string` | 情緒立場：`"goat"` \| `"king"` \| `"respect"` \| `"machine"` \| `"decider"` \| `"villain"` |
| `reasons` | `string[]` | 理由代碼，例：`["longevity", "iq", "leGM"]` |
| `voterTeam` | `string` | 效忠球隊代碼，例：`"LAL"`, `"GSW"`, `"BOS"` |
| `ageGroup` | `string` | 年齡組別：`"18-24"` \| `"25-34"` \| `"35-44"` \| `"45+"` |
| `gender` | `string` | 性別：`"m"` \| `"f"` \| `"o"` |
| `country` | `string` | ISO 國家代碼，例：`"TW"`, `"US"` |
| `city` | `string` | 城市名稱 |
| `createdAt` | `Timestamp` | 建立時間（建議 `serverTimestamp()`） |

**TypeScript 型別描述：**

```ts
interface VoteDoc {
  id: string;
  starId: "lbj"; // 擴展位元，未來可為 "kd" 等
  userId: string;
  status: "goat" | "hater" | "respect" | "villain";
  reasons: string[];
  voterTeam: string;   // 效忠球隊，例如 "LAL", "GSW", "BOS"
  ageGroup: string;    // "18-24", "25-34", "35-44", "45+"
  gender: "m" | "f" | "o";
  country: string;     // ISO 國家代碼 (如 "TW", "US")
  city: string;
  createdAt: Timestamp;
}
```

---

### 2.2 `profiles` 集合（戰區登錄 / 用戶維度快照）

用於存放「戰區登錄」介面填寫的年齡、性別、派系、地理，供投票時帶入 `votes` 與後續分析使用。文件 ID 建議使用 `userId`，一用戶一文件。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `userId` | `string` | 對應 Firebase Auth UID |
| `starId` | `string` | 球星識別，例：`"lbj"` |
| `ageGroup` | `string` | 同 `votes.ageGroup` |
| `gender` | `string` | 同 `votes.gender` |
| `voterTeam` | `string` | 同 `votes.voterTeam` |
| `country` | `string` | 同 `votes.country` |
| `city` | `string` | 同 `votes.city` |
| `hasVoted` | `boolean` | 是否已對該球星投過票（防重複；Transaction 與寫入 vote 同時更新） |
| `isPremium` | `boolean` | 分析師通行證／訂閱狀態；金流或 RevenueCat Webhook 寫入 |
| `updatedAt` | `Timestamp` | 最後更新時間（建議 `serverTimestamp()`） |

**設計意圖：** 將球隊、年齡與地理位置平面化於同一層，與 `votes` 欄位對齊，確保寫入投票時可直接複製，且能套用與 `votes` 相同的漏斗過濾邏輯（例如依國家／城市統計時可先查 profiles 再關聯 votes）。

---

## 3. 複合索引 (Composite Indexes) 需求

多維度漏斗查詢會對 `votes` 使用多個 `where()` 條件（如 `starId` + `voterTeam` + `ageGroup` + `gender` + `country` + `city`）。Firestore 規定：

- **多欄位等值查詢**：只要查詢中出現多個 `where()`（或 `where()` 搭配 `orderBy()`），就必須在 Firebase Console 建立對應的**複合索引**，否則查詢會拋錯並回傳索引建立連結。
- **索引欄位順序**：複合索引的欄位順序應與查詢中 `where` / `orderBy` 的順序一致（或依 Firebase 錯誤訊息中的連結自動生成）。

建議預先建立之複合索引（依實際查詢組合增減）：

| 集合 | 欄位順序 | 用途 |
|------|----------|------|
| `votes` | `starId` (Asc), `voterTeam` (Asc), `ageGroup` (Asc), `gender` (Asc), `country` (Asc), `city` (Asc) | 多維度漏斗：球隊 + 年齡 + 性別 + 國家 + 城市 |
| `votes` | `starId` (Asc), `country` (Asc), `city` (Asc), `createdAt` (Desc) | 地理 + 時間排序 |
| `votes` | `createdAt` (Desc) | LiveTicker 即時戰報（最近 10 筆） |

首次執行未建索引的查詢時，Firestore 會回傳錯誤並提供「建立索引」的連結，點擊即可在 Console 建立對應複合索引。

---

## 4. 全球聚合文件 `warzoneStats/global_summary`（極致節流）

圖表與跳表**嚴禁**直接掃描 `votes` 集合，一律改讀此單一文件以將「數千次讀取」簡化為「1 次讀取」。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `totalVotes` | `number` | 全球總票數 |
| `goat` / `fraud` / `king` / `mercenary` / `machine` / `stat_padder` | `number` | 各立場計數 |
| `recentVotes` | `array` | 最近 10 筆投票摘要：`{ status, city, country, voterTeam, createdAt }` |
| `reasonCountsLike` | `map<string, number>` | 粉方理由次數（reason key → 次數），供原因熱點「喜歡」 |
| `reasonCountsDislike` | `map<string, number>` | 黑方理由次數，供原因熱點「不喜歡」 |
| `countryCounts` | `map<string, { pro, anti }>` | 各國 pro/anti 票數（ISO2 → `{ pro, anti }`），供地圖著色 |
| `updatedAt` | `Timestamp` | 最後更新時間 |

- **寫入**：投票時 `handleSubmit` 與撤銷時 `revokeVote` 在各自 Transaction 內同步更新本文件（含 reasonCounts 與 countryCounts）。
- **讀取**：僅在 `WarzoneDataContext` 內開啟**唯一一個** `onSnapshot(warzoneStats/global_summary)`，再分發給 SentimentStats、AnalyticsDashboard、LiveTicker、PulseMap。

---

## 5. 組件／服務相依關係（本階段）

```
AuthContext (currentUser, profiles/{uid} 單一 Document 監聽)
    ↓
UserProfileSetup (寫入 profiles)
    ↓
VotePage / 投票表單 (讀 profiles → 寫入 votes + global_summary)
    ↓
WarzoneDataContext (唯一 onSnapshot: warzoneStats/global_summary)
    ↓
SentimentStats、AnalyticsDashboard、LiveTicker、PulseMap（嚴禁掃描 votes）
```

---

*最後更新：極致節流重構 — 聚合文件 + WarzoneDataContext 單一監聽。*
