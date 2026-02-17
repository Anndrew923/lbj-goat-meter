# APK Google 登入修復指南

本文件對應「APK 登入故障與憑證對齊」：確保 **debug.keystore** 的 SHA 指紋已正確配置，並驗證 `google-services.json` 與 Firebase Authorized domains。

## 0. 架構說明（原生插件 + Firebase Credential）

APK 內 WebView 不支援 Firebase Web SDK 的 `signInWithRedirect` / `signInWithPopup`，因此改為：

1. **原生登入**：使用 `@capgo/capacitor-social-login` 在 Android 上以原生流程取得 Google **idToken**。
2. **Firebase 驗證**：以 `GoogleAuthProvider.credential(idToken)` 建立 credential，再呼叫 `signInWithCredential(auth, credential)` 完成 Firebase 登入。

所需環境變數：`.env` 中需設定 **`VITE_GOOGLE_WEB_CLIENT_ID`**，值為 Firebase 專案的 **Web 用戶端 ID**（與 `google-services.json` 內 `oauth_client[].client_id` 一致，client_type 3）。

**server.url（可選）**：若在開發時使用 `cap run android` 並以 `npm run dev` 做 live reload，需在 `capacitor.config.json` 的 `server` 中設定 `url`，例如模擬器為 `http://10.0.2.2:5173`、實機為本機 IP `http://192.168.x.x:5173`，以防跨網域或連線問題。正式建置 APK 時不需設定 `server.url`（會從 `webDir` 載入）。

---

## 1. SHA 指紋提取與診斷

### 方式 A：PowerShell 腳本（建議）

在專案根目錄執行：

```powershell
.\scripts\get-debug-sha.ps1
```

腳本會輸出 **SHA-1** 與 **SHA-256**，請複製備用。

### 方式 B：keytool 手動提取

```powershell
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android
```

在輸出中尋找：
- **SHA1:** `xx:xx:xx:...`
- **SHA256:** `xx:xx:xx:...`

### 方式 C：Gradle signingReport

```powershell
cd android
.\gradlew.bat signingReport
```

在 `Variant: debug` 區塊中查看 `SHA-1` 與 `SHA-256`。

### 當前開發機指紋（僅供對照，請以本機執行結果為準）

| 類型   | 指紋 |
|--------|------|
| SHA-1  | `95:90:4A:60:5C:5A:8B:83:C7:B1:10:10:F7:BD:6C:AD:A5:24:C0:85` |
| SHA-256 | `12:D8:D3:78:B0:2E:03:75:A2:16:79:E7:A1:7F:F6:62:DB:99:51:A3:47:48:87:4C:68:41:6C:6D:E8:06:83:B3` |

### 必須完成的配置

1. **Firebase Console**
   - 前往 [Firebase Console](https://console.firebase.google.com) → 選擇專案
   - **專案設定** (齒輪) → **您的應用程式**
   - 若已有 Android 應用（`com.lbjgoatmeter.app`），點選後新增 **指紋**，貼上 SHA-1 與 SHA-256
   - 若尚未新增 Android 應用，先新增 Android 應用，**套件名稱** 填 `com.lbjgoatmeter.app`，再新增上述指紋

2. **Google Cloud Console (Credentials)**
   - 前往 [Google Cloud Console](https://console.cloud.google.com) → 同專案
   - **APIs & Services** → **Credentials**
   - 找到 **OAuth 2.0 Client IDs** 中類型為 **Android** 的用戶端（或為 Firebase 自動建立者）
   - 確認 **套件名稱** 為 `com.lbjgoatmeter.app`，且 **SHA-1 憑證指紋** 已填入上述 SHA-1
   - 若無 Android 類型用戶端，可新增 **Android** OAuth 用戶端，套件名稱 `com.lbjgoatmeter.app`，SHA-1 貼上指紋

完成後 Firebase 才能為此 APK 簽章核發 **Google ID Token**。

---

## 2. 配置檔案驗證 (Architecture First)

### 2.1 google-services.json

- **位置**：`android/app/google-services.json`（必須存在，build.gradle 才會套用 Google Services 外掛）。
- 若專案內尚未有此檔：
  1. Firebase Console → 專案設定 → **您的應用程式** → Android 應用（套件名稱 `com.lbjgoatmeter.app`）
  2. 下載 **google-services.json**，放到 `android/app/` 目錄。
  3. 可參考 `android/app/google-services.json.example` 的結構（僅欄位對照用，勿直接複製為正式檔）。

**必須驗證的欄位：**

| 欄位 | 預期值 | 說明 |
|------|--------|------|
| `client[].client_info.android_client_info.package_name` | `com.lbjgoatmeter.app` | 須與 `capacitor.config.json` 的 `appId` 一致 |
| `client[].client_info.mobile_sdk_app_id` | 非空 | Firebase 應用 ID |
| `client[].oauth_client[].client_id` | 以 `.apps.googleusercontent.com` 結尾 | 用於 Google 登入的 OAuth 用戶端 ID |

可用以下指令快速檢查套件名稱（PowerShell）：

```powershell
Get-Content android\app\google-services.json | Select-String "package_name|client_id"
```

### 2.2 Authorized domains（Firebase Authentication）

- 路徑：Firebase Console → **Authentication** → **Settings** → **Authorized domains**
- 建議至少包含：
  - `localhost`（本地與 WebView 除錯）
  - 若已部署 Web 版，則加入實際網域（例如 `yourapp.web.app` 或自訂網域）
- 在 **APK 內 WebView** 使用 Firebase JS SDK 時，部分環境會以 `localhost` 或專案預設網域送請求，故需確保上述網域已授權。

---

## 3. 環境清理與重建

在**已確認 SHA 指紋與 google-services.json / Authorized domains 正確**後，執行深度清理並重新建置，避免舊憑證或快取殘留。

### 步驟

```powershell
# 1. 清理 Gradle（含 build 與 .gradle 快取）
cd android
.\gradlew.bat clean

# 2. 回到專案根目錄，重新建置 Web 並同步到 Android
cd ..
npm run build
npx cap sync android

# 3. 重新建置 Debug APK
cd android
.\gradlew.bat assembleDebug
```

產出 APK 路徑：`android\app\build\outputs\apk\debug\app-debug.apk`。

### 驗證登入是否成功

1. 安裝 `app-debug.apk` 至實機或模擬器。
2. 在 app 內執行「使用 Google 登入」。
3. 若仍失敗，請檢查：
   - 瀏覽器/設備 Console 或 Logcat 錯誤碼（如 `auth/configuration-not-found`、`auth/unauthorized-domain`）。
   - Firebase Console → Authentication → Sign-in method 是否已啟用 **Google**。
   - 本機 SHA 是否與 Firebase / Google Cloud 中登錄的指紋完全一致（含換機或新電腦時重新取 SHA 並更新 Console）。

---

## 修復狀況回報範本

完成上述步驟後，可依下列格式回報：

- [ ] 已執行 `get-debug-sha.ps1` 或 `gradlew signingReport`，並取得 SHA-1 / SHA-256
- [ ] 已將指紋新增至 Firebase Console（Android 應用）
- [ ] 已將 SHA-1 新增至 Google Cloud Console → Credentials → Android OAuth 用戶端
- [ ] 已確認 `android/app/google-services.json` 存在，且 `package_name` = `com.lbjgoatmeter.app`、含正確 `client_id`
- [ ] 已確認 Firebase Authorized domains 包含 `localhost` 與實際網域（若有）
- [ ] 已執行 `gradlew clean` → `npm run build` → `npx cap sync android` → `gradlew assembleDebug`
- [ ] APK 是否能成功取得 Google ID Token / 完成登入：是 / 否（若否，請附錯誤訊息或錯誤碼）
