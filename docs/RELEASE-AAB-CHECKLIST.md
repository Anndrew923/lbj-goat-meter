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

### 4. 去模糊化（R8 / ProGuard mapping）

| 項目 | 狀態 | 說明 |
|------|------|------|
| Release 混淆 | ✅ | `minifyEnabled true`、`shrinkResources true`，使用 R8 + `proguard-android-optimize.txt` |
| 行號保留 | ✅ | `proguard-rules.pro` 已加入 `-keepattributes SourceFile,LineNumberTable`，利於 Crashlytics / Play 還原堆疊 |
| **mapping.txt 路徑** | — | 執行 `./gradlew bundleRelease` 後產生於：**`android/app/build/outputs/mapping/release/mapping.txt`** |
| Crashlytics 自動上傳 | ✅ | 已套用 `firebase-crashlytics-gradle`，且 Google Services / Crashlytics 於 `android` 區塊前套用，`buildTypes.release` 內 `firebaseCrashlytics` 有效；`bundleRelease` 時會執行 `uploadCrashlyticsMappingFileRelease` |
| Google Play 手動補傳 | — | 若 GPC 仍提示「缺少去模糊化檔案」，請在 **Play 主控台 → 版本 → 該版本 → 應用程式套件** 處上傳上述 `mapping.txt` |

**營運手動補傳**：當前版本 AAB 對應的 mapping 檔位置為（**僅在 `./gradlew bundleRelease` 成功完成後才會產生**）：

```
android/app/build/outputs/mapping/release/mapping.txt
```

- 若找不到該檔：請在專案根目錄的 `android/` 下執行 `./gradlew bundleRelease`，建置成功後 R8 會寫入上述路徑。
- 本機需已安裝 **Java 21**（專案 `variables.gradle` 指定 `JavaVersion.VERSION_21`），否則建置會失敗、mapping 不會生成。
- 每次重新執行 `bundleRelease` 後，該檔會覆寫為該次建置的 mapping，上傳到 Play 時請使用同一次建置產生的 mapping.txt。

---

### 5. 程式碼品質備註

- **Firestore**：`duration.value(60, 's')` 為常數，符合規則語法要求。
- **Gradle**：若 IDE 顯示 Gradle 版本錯誤，請確認使用專案內 `gradle-wrapper.properties`（目前為 8.14.3），或於終端執行 `./gradlew tasks` 驗證。

---

### 6. Google Play 商店顯示（應用名稱與圖示）

若內部測試／正式版在 Play 商店頁面顯示**套件名稱**（如 `com.thegoatmeter.warzone`）或**預設綠色機器人圖示**，請依下列方式修正：

| 項目 | 設定位置 | 說明 |
|------|----------|------|
| **應用名稱**（商店標題） | **Play 主控台** → 您的應用 → **成長** → **商店資訊** → **主要商店資訊** | 將 **應用程式名稱** 設為 **The GOAT Meter**（最長 30 字元）。此為商店頁面頂部顯示名稱，與裝置主畫面名稱（來自 APK 內 `strings.xml`）可一致。 |
| **高解析度圖示**（選填） | 同上 → **圖形** | 可上傳 **512 x 512** 圖示，用於商店列表；未上傳時會使用 AAB 內的 launcher 圖示。 |
| **裝置主畫面名稱與圖示** | 專案內建 | 名稱：`android/app/src/main/res/values/strings.xml` 的 `app_name`（已為 "The GOAT Meter"）。圖示：`res` 內 `ic_launcher*`，已改為自訂儀表風格圖示（非預設機器人）。 |

**注意**：商店頁面標題與「未審核」等字樣由 Play 主控台設定與審核狀態決定；內部測試時若尚未填寫主要商店資訊，可能暫時顯示套件名稱，填寫並儲存後即可顯示 **The GOAT Meter**。

---

*檢查完成日期：依本檔最後更新為準*
