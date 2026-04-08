# iOS `Info.plist` 權限描述草案（GOAT Meter: LeBron）

本文件提供 iOS 上架前可直接評估的 `Info.plist` 權限文案，對齊目前功能實作與 App Store 隱私審查重點。

## 1) 相簿存取（戰報卡儲存）

- `NSPhotoLibraryAddUsageDescription`
  - 建議文案（繁中）：`我們需要相簿新增權限，才能將你的 GOAT 戰報卡儲存到相簿，方便分享與留存。`
  - Suggested copy (EN): `We need photo library add permission to save your GOAT battle cards for sharing and personal archive.`
  - 對應功能：`src/utils/battleCardGallerySave.js`（原生相簿寫入）

- `NSPhotoLibraryUsageDescription`（可選）
  - 建議文案（繁中）：`我們需要存取相簿，讓你在應用內選取或檢視已儲存的戰報素材。`
  - Suggested copy (EN): `We need photo library access so you can select or preview saved battle assets in the app.`
  - 註記：目前若僅「寫入」相簿，可先不啟用；未來有讀取需求再加入。

## 2) 位置權限（戰區地理統計）

- `NSLocationWhenInUseUsageDescription`
  - 建議文案（繁中）：`我們會在你使用期間取得位置資訊，用於戰區歸屬與地區統計分析，不會用於背景持續追蹤。`
  - Suggested copy (EN): `We use your location while using the app for warzone assignment and regional analytics. We do not track location continuously in background.`
  - 對應功能：`src/lib/geolocation.js`（戰區登錄定位）

- `NSLocationAlwaysAndWhenInUseUsageDescription`（預設不建議啟用）
  - 建議文案（繁中）：`我們需要背景位置權限以在背景更新地區任務狀態。`
  - Suggested copy (EN): `We need background location permission to update regional mission status while the app is in background.`
  - 註記：當前產品流程無明確背景定位需求，若無必要請勿加入，以降低審查風險。

## 3) 追蹤意圖（ATT）

- `NSUserTrackingUsageDescription`（若啟用 ATT 才加入）
  - 建議文案（繁中）：`我們會在獲得你的同意後使用追蹤資料，改善廣告歸因與活動成效分析。`
  - Suggested copy (EN): `With your permission, we use tracking data to improve ad attribution and campaign performance analytics.`
  - 註記：若只做第一方分析且不跨 App/網站追蹤，可不啟用 ATT。

## 4) 建議上架前檢核

- 僅保留「實際有用到」的權限 key，避免審查質疑 over-permission。
- 權限彈窗時機需對齊使用情境（例如按下儲存戰報卡時才請求相簿）。
- 隱私政策頁面需同步描述位置與相簿用途，且與 `Info.plist` 文案一致。
