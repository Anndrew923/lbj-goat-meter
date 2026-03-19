# 黃金鑰匙（Golden Key）對齊指南

出現 **「Signature missing」** 或 **「安全驗證未通過」** 時，代表前後端金鑰未對齊。

## 後端（Cloud Functions）

- **設定方式**（已執行過）：
  ```bash
  firebase experiments:enable legacyRuntimeConfigCommands
  firebase functions:config:set goat.golden_key_secret="ChosenOne_Warzone_Supernova_Secure_Key_2026"
  firebase deploy --only functions
  ```
- **讀取來源**：`functions.config().goat.golden_key_secret`（或環境變數 `GOLDEN_KEY_SECRET` / `GOAT_GOLDEN_KEY_SECRET`）。
- 若你改過密鑰，請再執行一次 `config:set` 並重新 deploy functions。

## 前端（Vite / Netlify / 本機 build）

- **環境變數名稱**：`VITE_GOAT_GOLDEN_KEY_SECRET`
- **值必須與後端完全一致**，例如：
  ```
  VITE_GOAT_GOLDEN_KEY_SECRET=ChosenOne_Warzone_Supernova_Secure_Key_2026
  ```
- **本機**：在專案根目錄的 `.env` 或 `.env.production` 中設定，再執行 `npm run build`。
- **Netlify**：Site settings → Environment variables → 新增 `VITE_GOAT_GOLDEN_KEY_SECRET`，值同上 → 儲存後觸發一次 Redeploy。
- **Capacitor / APK**：使用有設定該變數的 build 指令（例如 CI 或本機 build 時匯入 `.env.production`），否則打進 App 的 bundle 不會帶密鑰，會一直 signature-missing。

## 對齊檢查清單

| 項目 | 後端 | 前端 |
|------|------|------|
| 密鑰來源 | `goat.golden_key_secret` 或 env | `VITE_GOAT_GOLDEN_KEY_SECRET` |
| 目前範例值 | `ChosenOne_Warzone_Supernova_Secure_Key_2026` | 同上（必須一字不差） |
| 設定後需 | `firebase deploy --only functions` | 重新 build + 部署／安裝新 APK |

對齊後，主投票、重置立場、突發戰區應不再出現 signature-missing / 安全驗證未通過。
