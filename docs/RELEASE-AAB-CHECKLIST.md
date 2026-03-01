# The GOAT Meter — AAB 首發封裝與安檢檢查清單

## 工作成果檢查報告

### 1. Firestore 規則（2026 修正版）

| 項目 | 狀態 | 說明 |
|------|------|------|
| `service cloud.firestore` 結構 | ✅ | 規則已包在正確的 service 區塊內 |
| `profiles` 撤票相容 | ✅ | `hasVoted` 可更新，需本人 + App Check |
| `votes` 建立校驗 | ✅ | `isValidVote()` 檢查 starId、status、userId、createdAt |
| `device_locks` 集合 | ✅ | 讀需登入，寫需登入 + App Check |
| `warzoneStats` | ✅ | 公開讀，寫需認證 + App Check |
| **createdAt 與 serverTimestamp()** | ✅ 已修正 | 規則評估時 `serverTimestamp()` 為 null，已改為允許 `createdAt == null` 或 60 秒內時間戳，與 `VoteService.js` 的 `createdAt: serverTimestamp()` 相容 |

**注意**：部署前請執行 `firebase login` 後再執行 `firebase deploy --only firestore:rules` 與雲端同步。

---

### 2. Capacitor 網頁除錯

| 項目 | 狀態 |
|------|------|
| `webContentsDebuggingEnabled` | ✅ 已設為 `false`，發布版無法透過 USB + Chrome DevTools 檢視 WebView |

---

### 3. 安全簽章架構

| 項目 | 狀態 | 說明 |
|------|------|------|
| `.gitignore` | ✅ | 已忽略 `android/keystore.properties`、`*.jks`、`*.keystore` |
| 金鑰不硬編碼 | ✅ | `build.gradle` 僅從 `keystore.properties` 讀取 |
| `storeFile` 路徑 | ✅ | 使用 `rootProject.file(...)`，路徑相對於 `android/`，與範本一致 |
| 無 keystore 時建置 | ✅ | 僅在 `keystore.properties` 可讀時套用 `signingConfig`，未配置時 release 仍可建置（未簽章） |
| `keystore.properties.example` | ✅ | 已提供欄位範本與路徑說明 |

**Boss 操作**：複製 `android/keystore.properties.example` → `android/keystore.properties`，填入實際路徑與密碼後執行 `./gradlew bundleRelease`。

---

### 4. 程式碼品質備註

- **Firestore**：`duration.value(60, 's')` 為常數，符合規則語法要求。
- **Gradle**：若 IDE 顯示 Gradle 版本錯誤，請確認使用專案內 `gradle-wrapper.properties`（目前為 8.14.3），或於終端執行 `./gradlew tasks` 驗證。

---

*檢查完成日期：依本檔最後更新為準*
