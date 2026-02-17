# AdMob 測試設備 ID（給 Boss）

**目前採用全域測試鎖定**（`VITE_ADMOB_USE_TEST_IDS=true`），所有廣告請求已自動導向 Google 官方測試 ID，**不需填寫設備 ID**。以下為選用說明：若日後改為「指定設備測試」可參考。

未上架前可選用 **測試設備 ID**，讓指定手機以測試模式請求正式廣告（不計入有效流量），避免封號。

## 1. 在 .env 已設定的項目

- `VITE_ADMOB_USE_TEST_IDS=true`：強制使用 Google 官方測試廣告。
- `VITE_ADMOB_TEST_DEVICE_IDS=`：在此填入測試手機 ID（多台用逗號分隔）。

## 2. 用 Logcat 取得測試手機 ID

1. **手機接上電腦**，並已開啟 USB 偵錯；電腦已安裝 [Android Platform Tools (adb)](https://developer.android.com/studio/releases/platform-tools)。

2. **在專案目錄執行**（任選一種）：
   - 只看廣告相關日誌：
     ```bash
     adb logcat -s Ads
     ```
   - 或過濾包含 "Test device" 的訊息：
     ```bash
     adb logcat | findstr "Test device"
     ```
     （PowerShell 可用 `adb logcat | Select-String "Test device"`）

3. **在手機上打開 App**，觸發一次插頁廣告（例如在投票頁點「下載戰報」）。

4. **在 Logcat 輸出中尋找**類似：
   - `Use RequestConfiguration.Builder().setTestDeviceIds(Arrays.asList("XXXXXXXXXXXXXXXX"))`
   - 或 `Test device ID: XXXXXXXXXXXXXXXX`

5. **把 `XXXXXXXXXXXXXXXX` 複製到 .env**：
   ```env
   VITE_ADMOB_TEST_DEVICE_IDS=XXXXXXXXXXXXXXXX
   ```
   若有多台測試機，用逗號分隔：`VITE_ADMOB_TEST_DEVICE_IDS=ID1,ID2`。

6. **重新建置並同步**：
   ```bash
   npm run build
   npx cap sync android
   ```
   再在該手機上跑一次 App 即可用測試設備模式。

## 3. 上架前記得

- 正式發布前可將 `VITE_ADMOB_USE_TEST_IDS` 改為 `false`（或移除），改用正式廣告單元。
- `.env` 勿提交至 Git（應已在 .gitignore）。
