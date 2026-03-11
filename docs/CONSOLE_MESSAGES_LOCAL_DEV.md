# 本地開發環境 — 控制台訊息說明

本文件說明本地測試時常見的控制台訊息，哪些屬**預期行為**、哪些需在**正式環境**前處理。

---

## 預期／可忽略（本地開發）

| 訊息 | 說明 |
|------|------|
| `[vite] connecting...` / `connected.` | Vite 開發伺服器連線正常。 |
| `Firebase` 配置資訊（apiKey、projectId 等） | 確認已連接專案，可忽略。 |
| `[WarzoneDataContext] warzonestats/global_summary` | 取得全球統計，功能正常。 |
| `[RewardedAdsService] Web 端 ... localhost 使用佔位 Token` | 本地無廣告 SDK 時使用佔位 token，後端 `shouldBypassHardSecurity` 會放行，**符合設計**。 |
| `[ResetPositionService] resetPosition 成功` / `[AuthContext] resetPosition 完成` | 重置立場流程正常。 |

---

## 需留意（本地可選、正式必設）

| 訊息 | 說明與建議 |
|------|------------|
| `[Firebase] 找不到 App Check Site Key (未初始化)` | 本地未設 `VITE_APP_CHECK_SITE_KEY` 時會略過 App Check。**正式環境**需在 Netlify 設定該變數並部署。 |
| `[RecaptchaService] grecaptcha 未就緒...` | 可能為瀏覽器擴充、擋廣告或網路阻擋。本地因 `shouldBypassHardSecurity` 仍可投票／重置。**正式環境**需確保 reCAPTCHA 可連線。 |
| `POST ... recaptcha/api2/pat 401 (Unauthorized)` | 常與 App Check 使用 reCAPTCHA Enterprise 或金鑰／網域設定有關。本地不影響投票／重置（後端 bypass）。**正式環境**須確認 reCAPTCHA 金鑰與網域正確，並依 [SECRET_MANAGER_SETUP.md](./SECRET_MANAGER_SETUP.md) 設定後端 Secret。 |

---

## 總結

- **投票、重置**：在本地 bypass 下可正常運作，上述警告不影響功能。
- **正式環境**：須完成 App Check Site Key、reCAPTCHA 金鑰與後端 Secret 設定，並在 Netlify 部署後再驗證一次。
