# 建置狀態回報（bundleRelease + JAVA_HOME）

## 1. JAVA_HOME 設定 ✅ 已完成

- **已將使用者環境變數 `JAVA_HOME` 永久設為 JDK 21。**
- 路徑：`C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot`
- 設定方式：`[Environment]::SetEnvironmentVariable("JAVA_HOME", "...", "User")`
- **注意**：已開啟的終端機 / Cursor 不會自動套用新的環境變數，需**重新開一個終端機**或**重開 Cursor** 後，新視窗才會讀到更新後的 JAVA_HOME。

---

## 2. 建置（bundleRelease）狀態 ⚠️ 可能卡住或未完整結束

### 已執行到的階段（terminal 790080）

- 建置已跑超過 **約 20 分鐘**（running_for_seconds: 1205）。
- 已完成的關鍵步驟包括：
  - `:app:minifyReleaseWithR8`（R8 混淆，會產出 mapping）
  - `:app:lintVitalRelease`
  - 多個模組的 compile、merge、process 等任務。

### 目前狀況

- 日誌中**沒有**出現 `BUILD SUCCESSFUL` 或 `BUILD FAILED`，因此無法從日誌判斷建置是否已正常結束。
- 在 `android/app/build/outputs/mapping/release/` 下已存在：
  - `usage.txt`
  - `seeds.txt`
- **未確認到** `mapping.txt` 是否存在（R8 完整跑完通常會產出此檔；若建置中斷或卡住，可能尚未寫入）。

### 可能原因

1. **建置仍在背景跑**：例如卡在 `uploadCrashlyticsMappingFileRelease`（上傳 mapping 到 Firebase）或後續打包步驟，網路或 Firebase 設定可能導致變慢或卡住。
2. **逾時或中斷**：先前由工具觸發的建置有設逾時，若時間到就被中止，可能導致建置未跑完、`mapping.txt` 未產生或未寫完。
3. **Gradle Daemon**：若有多個 daemon 或資源吃滿，也可能造成看起來「卡住」。

---

## 3. 建議你現在做的事

### 3.1 確認 JAVA_HOME（新終端機）

1. **關掉目前終端機，新開一個**（或重開 Cursor 再開終端機）。
2. 執行：
   ```powershell
   [Environment]::GetEnvironmentVariable("JAVA_HOME", "User")
   ```
   應顯示：`C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot`

### 3.2 確認 mapping 與 AAB 是否已產生

在專案目錄執行：

```powershell
# 檢查 mapping 目錄
Get-ChildItem "c:\Users\i\Desktop\lbj-goat-meter\android\app\build\outputs\mapping\release"

# 檢查 AAB 是否產生
Get-ChildItem "c:\Users\i\Desktop\lbj-goat-meter\android\app\build\outputs\bundle\release" -Filter "*.aab"
```

- 若有 `mapping.txt` 且存在 `*.aab` → 代表建置已成功完成，可直接用該 mapping 上傳。
- 若沒有 `mapping.txt` 或沒有 AAB → 需要再跑一次完整建置。

### 3.3 若建置未完成：手動重新建置

1. **關閉可能還在跑的 Gradle**（可選）：
   ```powershell
   cd c:\Users\i\Desktop\lbj-goat-meter\android
   .\gradlew --stop
   ```

2. **在新終端機執行**（會使用新的 JAVA_HOME）：
   ```powershell
   cd c:\Users\i\Desktop\lbj-goat-meter\android
   .\gradlew bundleRelease
   ```

3. 若卡在 **Uploading mapping file to Firebase** 很久，可考慮暫時關閉自動上傳，先拿到本地 mapping：
   - 在 `android/app/build.gradle` 的 `release` 裡將 `mappingFileUploadEnabled` 改為 `false`，建置完成後再手動上傳 mapping。

### 3.4 mapping.txt 路徑（建置成功後）

- 路徑：`android\app\build\outputs\mapping\release\mapping.txt`
- 與這次建置產生的 AAB 為同一版本，上傳到 Google Play 時請用同一次建置的 mapping。

---

## 4. 總結

| 項目           | 狀態 |
|----------------|------|
| JAVA_HOME 改為 JDK 21 | ✅ 已寫入使用者環境變數，新終端機生效 |
| bundleRelease 建置     | ⚠️ 有執行並跑過 R8，但日誌未見成功/失敗，可能卡住或逾時 |
| mapping.txt            | ❓ 需在本機檢查上述目錄是否已有檔案 |
| 建議                   | 新開終端機 → 檢查 mapping / AAB → 若無則 `.\gradlew --stop` 後再跑 `.\gradlew bundleRelease` |
