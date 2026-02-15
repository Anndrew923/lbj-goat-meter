# i18n 清零行動 — 已清理字串清單

切換到英文語系後，介面應不再出現任何中文字元（註解、console、constants 內建 label 僅供程式使用，UI 一律經 `t('common:key')` 取得文案）。

---

## 一、locales 擴充鍵（common）

以下鍵已加入 `locales/zh-TW/common.json` 與 `locales/en/common.json`，並在組件／服務中以 `t('common:key')` 或 `i18n.t('common:key')` 使用。

### 儀表板（AnalyticsDashboard）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| loadingDashboard | 載入儀表板… | Loading dashboard… |
| loadErrorShort | 無法載入數據。 | Failed to load data. |
| radarTitle | 立場雷達 | Stance radar |
| radarShareName | 占比 % | Share % |
| radarShareLabel | 占比 | Share |
| topReasonsLike | 支持方 Top 3 原因 | Top 3 reasons (support) |
| topReasonsDislike | 反對方 Top 3 原因 | Top 3 reasons (oppose) |
| noData | 尚無數據 | No data yet |

### 跑馬燈（LiveTicker）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| liveTicker | 即時戰報 | Live ticker |
| tickerFrom | ，一位來自 | , a fan from |
| unknown | 未知 | Unknown |
| tickerOf | 的 | (empty in EN) |
| tickerVoted | 投下了 | voted |
| tickerExclamation | ！ | ! |
| justNow | 剛剛 | Just now |
| secondsAgo | {{count}}秒前 | {{count}}s ago |
| minutesAgo | {{count}}分鐘前 | {{count}}m ago |
| earlier | 稍早 | Earlier |
| fanSuffix | 球迷 | fan |
| someFan | 某地球迷 | A fan |
| team_* | 洛杉磯、灣區… | Los Angeles, Bay Area… |

### 情緒統計（SentimentStats）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| loadingGlobalData | 載入全球數據… | Loading global data… |
| loadErrorTryAgain | 無法載入數據，請稍後再試。 | Failed to load data. Please try again. |
| globalVoteDistribution | 全球投票分佈 | Global vote distribution |
| totalVotesCount | 共 {{count}} 票 | {{count}} votes total |
| other | 其他 | Other |

### 地圖（PulseMap）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| loadingMap | 載入地圖… | Loading map… |
| mapLoadError | 地圖資料載入失敗 | Map data failed to load |
| globalSentimentMap | 全球情緒地圖 | Global sentiment map |
| mapLegend | 金＝粉方佔優 · 紫＝黑方佔優 · 點擊國家篩選 | Gold = support · Purple = oppose · Click country to filter |

### 登入與權限

| 鍵名 | 中文 | 英文 |
|------|------|------|
| needLogin | 需要登入 | Sign in required |
| loginPromptDesc | 登入後即可投票並領取專屬戰報卡。 | Sign in to vote and get your battle card. |
| later | 稍後再說 | Later |
| goToLogin | 前往登入 | Go to sign in |
| loading | 載入中… | Loading… |
| whoIsGoat | 誰才是真正的 GOAT？ | Who is the real GOAT? |
| loggingIn | 登入中… | Signing in… |
| signInWithGoogle | 使用 Google 登入 | Sign in with Google |
| browseAsGuest | 不留名參觀 (Browse as Guest) | Browse as Guest |
| browseAsGuestAria | 不留名參觀 | Browse as guest |
| verifying | 驗證中… | Verifying… |

### 篩選（FilterFunnel）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| filterDrawerAria | 多維度篩選 | Multi-dimensional filter |
| filterPanelTitle | 篩選儀表 | Filter panel |
| ageGroupLabel | 年齡組別 | Age group |
| genderLabel | 性別 | Gender |
| teamLabel | 效忠球隊 | Team allegiance |
| cityLabel | 城市 | City |
| selectTeam | 選擇球隊 | Select team |
| all | 全部 | All |
| cityPlaceholder | 輸入城市名稱 | Enter city name |
| clearAll | 清除全部 | Clear all |
| close | 關閉 | Close |
| ageGroup_18_24 … ageGroup_45_plus | 18–24 歲… 45 歲以上 | 18–24 … 45+ |
| gender_m / gender_f / gender_o | 男性 / 女性 / 其他 | Male / Female / Other |
| team_LAL … team_OTHER | 洛杉磯… 其他 | Los Angeles … Other |

### 分析師閘口（AnalystGate）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| unlockAnalystTitle | 解鎖全球精細化分析報告 | Unlock global analyst report |
| unlockAnalystDesc | 取得分析師通行證，查看依國家、球隊、年齡拆分的深度數據與趨勢。 | Get analyst access for breakdowns by country, team, and age. |
| paymentProcessing | 支付處理中… | Processing payment… |
| simulatePurchase | 模擬購買 | Simulate purchase |
| sandboxNote | （沙盒：寫入 Firestore isPremium，正式版串接 RevenueCat） | (Sandbox: writes isPremium to Firestore; production uses RevenueCat) |
| analystGateAria | 分析師通行證解鎖區 | Analyst pass unlock |

### 戰區登錄（UserProfileSetup）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| profileSetupTitle | 戰區登錄 | Profile setup |
| step1Title | 身分定義 | Identity |
| step2Title | 派系效忠與所在地 | Team & location |
| ageGroup / gender | 年齡組別 / 性別 | Age group / Gender |
| supportTeamLabel | 支持的球隊（城市＋代表色） | Support team (city + colors) |
| countryLabel | 國家 | Country |
| gettingLocation | 正在取得所在地… | Getting location… |
| pleaseSelect | 請選擇 | Please select |
| cityOptional | 城市（選填） | City (optional) |
| cityPlaceholderExample | 例：台北、New York | e.g. Taipei, New York |
| coordinatesLocked | 坐標已鎖定 | Location locked |
| next / back | 下一步 / 上一步 | Next / Back |
| completeProfile | 完成登錄 | Complete setup |
| saving | 儲存中… | Saving… |
| saveError | 儲存失敗，請稍後再試 | Save failed. Please try again. |
| detectedCountry | 當前偵測: {{code}} | Detected: {{code}} |
| country_* | 台灣、美國… | Taiwan, United States… |

### 認證錯誤（AuthContext + AccountService）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| signOutFailed | 登出失敗 | Sign out failed |
| noUserForDelete | 無法取得當前用戶，請先登入 | No current user. Please sign in first. |
| deleteAccountFailed | 刪除帳號失敗 | Delete account failed |
| authError_firebaseNotReady | Firebase 尚未設定或初始化失敗… | Firebase is not configured or failed to initialize… |
| authError_configNotFound | Firebase 認證尚未設定完成… | Firebase Auth is not set up… |
| authError_popupClosed | 登入視窗已關閉… | Sign-in window was closed… |
| authError_popupBlocked | 登入視窗被瀏覽器封鎖… | Sign-in popup was blocked… |
| authError_requiresRecentLogin | 此操作需重新驗證身分… | This action requires recent sign-in… |
| authError_loginFailed | Google 登入失敗 | Google sign-in failed |
| error_missingDbOrUid | 缺少 Firestore 或用戶 UID | Missing Firestore or user UID |
| error_profileNotFoundRevote | 找不到戰區資料，無法重置投票 | Profile not found. Cannot reset vote. |
| error_hasNotVoted | 您尚未投票，無需重置 | You have not voted yet. |

### 語系選項（LanguageToggle）

| 鍵名 | 中文 | 英文 |
|------|------|------|
| lang_zhTW | 繁體中文 | Chinese (Traditional) |
| lang_en | English | English |

---

## 二、已修改的檔案

- **locales**: `src/i18n/locales/zh-TW/common.json`、`src/i18n/locales/en/common.json`（擴充上述鍵）
- **組件**: `AnalyticsDashboard.jsx`、`LiveTicker.jsx`、`SentimentStats.jsx`、`PulseMap.jsx`、`LoginPromptModal.jsx`、`LoginPage.jsx`（pages）、`ProtectedRoute.jsx`、`FilterFunnel.jsx`、`AnalystGate.jsx`、`UserProfileSetup.jsx`、`LanguageToggle.jsx`
- **Context**: `AuthContext.jsx`（使用者可見錯誤改為 `i18n.t('common:...')`）
- **服務**: `AccountService.js`（拋出錯誤改為 `i18n.t('common:error_...)`）

雷達圖軸標籤與原因標籤已由 `getStancesForArena()` / `getReasonLabelMap()` 依語系提供，本次僅補上標題、Tooltip、區塊標題與空狀態的 `t()`。

---

## 三、品質檢查結果（複查摘要）

- **common 鍵一致性**：`zh-TW/common.json` 與 `en/common.json` 鍵完全一致（160 鍵），無缺鍵或多鍵。
- **使用者可見中文**：已移除 LiveTicker 結尾硬編碼「！」，改為 `t('tickerExclamation')`；其餘中文僅存於註解、`console`、`constants.js` 內建 label（UI 已改為 `t()` 顯示，不直接使用）。
- **AnalyticsDashboard**：合併為單一 `useTranslation('common')`，同時取得 `t` 與 `i18n`，避免重複呼叫。
- **Build**：`npm run build` 通過；Lint 無錯誤。

## 四、驗證方式

1. 將語系切換為 English（設定或 LanguageToggle）。
2. 依序檢查：登入頁、投票戰場、篩選抽屜、儀表板、跑馬燈、地圖、戰區登錄、分析師閘口、設定與登出／刪除帳號流程。
3. 預期：畫面上不應出現任何中文字元；若仍有殘留，請依鍵名在 common 補譯並改為 `t('common:key')`。
