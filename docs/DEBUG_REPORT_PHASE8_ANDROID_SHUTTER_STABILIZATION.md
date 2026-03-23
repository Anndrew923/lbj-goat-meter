# Phase 8 — Android 戰報產圖快門穩定化技術報告

**專案**：GOAT Meter: LeBron（`lbj-goat-meter`）  
**範圍**：Capacitor WebView + `capacitor-screenshot` 全螢幕截圖 → 依戰報卡 `layoutRect` 裁切 → 相簿  
**主要實作位置**：`src/components/BattleCard.jsx`（原生路徑）、`src/components/VotingArena.jsx`（廣告後直接 `saveToGallery`）  
**狀態**：實機驗證成功率已穩定於 **80%+**（Realme GT Neo 3 / Android 14 等場景）

---

## 1. 問題定義 (Problem Definition)

### 1.1 裝置與現象

在 **Realme GT Neo 3（Android 14）** 搭配 **Capacitor WebView** 的全螢幕點陣截圖路徑中，觀測到兩類典型失敗輸出：

| 現象 | 使用者可感知 | 技術含義（推論） |
|------|----------------|------------------|
| **黑屏 / 大面積黑底** | 存進相簿的圖片整張或邊緣為黑 | 合成管線尚未把 WebView 內容提交至與截圖同一幀的 buffer，或採樣到 App 視窗外黑底 |
| **半圖** | 畫面上半正常、下半全黑或內容凍結 | 單幀內容不完整；常見 **底部列** 與 **中央 alpha** 異常（合成未完成） |

**弱網**會拉長圖片解碼與排版完成時間；**高階 GPU / HWC** 路徑則可能延後「最終合成」，若快門過早，容易與「資源尚未就緒」疊加成同一類失敗。

### 1.2 緩存粘滯（Cache Stickiness）

在連續重試（使用者連點或程式自動重拍）時，曾觀測到 **前一幀的錯誤狀態被沿用**：同一套 DOM 在短時間內重複截圖，失敗型態高度相關（連續半圖、連續底黑），彷彿 **GPU／TextureView／WebView 合成緩存** 未在下一幀前被強制失效。

**對策方向**：非僅「多等幾毫秒」，而是 **階梯式** 分離「資源就緒 → UI 狀態切換 → 物理破冰 → 驗收失敗再破冰重拍」，避免在同一粘滯狀態下無效重試。

---

## 2. 核心解決方案：階梯式渲染管線 (Stepped Rendering Pipeline)

實作於 `BattleCard.jsx` 之 `handleDownload` **原生分支**（`Capacitor.isNativePlatform()`）。Web 端仍走 `html-to-image` / `toPng`，不適用本管線。

### 第一階：資源預載 (Image Decoding & Paint Ready Check)

- **`decodeBattleCardImages(el)`**：對戰報卡根節點內所有 `<img>` 盡力觸發 `decode()`／`onload`，並以逾時保護避免弱網卡死。
- **`waitForCardImagesPaintReady(el, EXPORT_IMAGE_READY_MAX_WAIT_MS, onSlow)`**：輪詢 `img.complete && naturalWidth > 0`，必要時切換遮罩文案（弱網提示）。
- **設計意圖**：快門前保證 **位圖已進入可繪狀態**，避免「視覺上已顯示、點陣尚未就緒」的競態。

### 第二階：渲染解耦 (Shutter Decoupling)

- **`flushSync(() => setIsCapturing(true))`**：卸載全螢幕「生成中」遮罩（條件為 `isExporting && !isCapturing`），避免 `Screenshot.take()` 採到遮罩。
- **`NATIVE_SHUTTER_DOM_WAIT_MS`（250ms）死等**：給 React 提交、樣式套用、合成器 **完整一輪** 時間，再進入破冰與快門。

### 第三階：物理破冰 (Physical Icebreaking)

- **`nudgeCardOpacityForGpuSwap(cardEl)`**：短暫將 `opacity` 設為 `0.99` 再還原，搭配 `offsetHeight` 迫使 **HWC／合成路徑** 走一次更新。
- **`nudgeCardPaddingBottomIcebreak(cardEl)`**：`padding-bottom: 1px` 一幀後還原，迫使 **layout / 重排**。
- **`aggressiveDisplayIcebreak(cardEl)`（非首拍）**：`display: none` → `offsetHeight` → `display: flex`（與戰報卡根節點排版一致），**擊碎 WebView GPU 緩存粘滯**；首拍不執行，避免無謂閃爍。
- **重試間隔**：第 2、3 拍前分別等待 `NATIVE_AFTER_FAIL1_MS` / `NATIVE_AFTER_FAIL2_MS`，再進入破冰與重拍。

### 第四階：動態九宮格驗證 (Wide-Range Hammer Lock with 3×3 Grid)

- **`Screenshot.take()`** 取得全螢幕 base64。
- **`validateNativeScreenshotBase64(base64, layoutRect)`**：
  - 依 `layoutRect` 與 `getNativeScreenshotPixelMapping` 將 **戰報卡區域內** 九點映射至點陣座標（邊緣內縮 `HAMMER_CARD_EDGE_INSET`，避免採到全螢幕黑底）。
  - 將截圖縮畫至 **`HAMMER_LOCK_CANVAS_PX`（1000×1000）** 工作畫布後讀取像素。
  - **死像素**：`R+G+B < HAMMER_DEAD_PIXEL_RGB_SUM_LT`（預設 **&lt; 10**）；超過 **`HAMMER_MAX_DEAD_PIXELS`（3）** 則失敗。
  - **底列全黑防線**：底部三點（索引 6–8）若全為死像素 → 失敗（對應半圖常見底黑）。
  - **中央 alpha**：中心點 alpha **&lt; `HAMMER_CENTER_ALPHA_MIN`（250）** → 視為合成未完成／半圖。
- **失敗**：回到第三階邏輯重試，最多 **`NATIVE_HAMMER_MAX_ATTEMPTS`（3）** 次；仍失敗則進入 UX 提示（見第 4 節）與 `NATIVE_AFTER_FAIL3_MS` 緩衝。

### 第五階：結果產出

- 驗收通過 → **`cropNativeScreenshotToElement`** → **`Media.savePhoto`** → Toast。
- 驗收或裁切失敗 → **`Dialog.alert`**（文案見 i18n `exportFailedTitle` / `exportFailedNativeRenderAnomalyAdvice`）。

---

## 3. 關鍵技術指標 (Technical Constants)

以下常數定義於 **`src/components/BattleCard.jsx`**（若調參請同步更新本文件與實機回歸測試）。

| 常數 | 值 | 用途摘要 |
|------|-----|----------|
| `NATIVE_SHUTTER_DOM_WAIT_MS` | **250** | 遮罩隱藏後死等，DOM／合成落地 |
| `NATIVE_HAMMER_MAX_ATTEMPTS` | **3** | 九宮格驗收失敗後最大重拍次數 |
| `NATIVE_AFTER_FAIL1_MS` | **300** | 第 2 拍前等待 |
| `NATIVE_AFTER_FAIL2_MS` | **800** | 第 3 拍前等待 |
| `NATIVE_AFTER_FAIL3_MS` | **1200** | 全數失敗後、彈窗前的最後緩衝 |
| `HAMMER_DEAD_PIXEL_RGB_SUM_LT` | **10** | 死像素：`R+G+B` 嚴格小於此值 |
| `HAMMER_MAX_DEAD_PIXELS` | **3** | 死像素超過此數 → 該幀截圖無效 |
| `HAMMER_CENTER_ALPHA_MIN` | **250** | 中心點 alpha 過低 → 半圖／合成未完成 |
| `HAMMER_LOCK_CANVAS_PX` | **1000** | Hammer 抽樣用縮圖邊長 |
| `HAMMER_CARD_EDGE_INSET` | **0.1** | 九點相對卡面比例內縮（避免邊緣黑） |
| `EXPORT_IMAGE_READY_MAX_WAIT_MS` | **2000** | 圖片就緒輪詢上限（弱網） |
| `EXPORT_IMAGE_POLL_INTERVAL_MS` | **50** | 就緒輪詢間隔 |
| `CROP_SAFETY_INSET_PX` | **2** | 裁切內縮，避免邊緣雜訊 |
| `CROP_BITMAP_MISMATCH_TOLERANCE_PX` | **2** | 點陣與 `inner×dpr` 比對容差 |
| `NATIVE_EXPORT_MIN_PX` | **1280** | 輸出正方形最小邊長（邏輯約 640×2x） |
| `EXPORT_PAINT_WAIT_MS` | **1000** | 僅 **Web / toPng** 路徑使用 |

**備註**：`nudgeCardOpacityForGpuSwap` 使用 **0.99 → 1** 透明度抖動，屬實作細節，非獨立常數檔。

---

## 4. UX 責任歸屬導引 (UX Blame-Shifting Logic)

產品文案（`common.json`）將失敗主因歸因於 **「網路環境不佳」**，理由如下：

1. **與觀測一致**：弱網下圖片解碼與主執行緒／渲染管線競態加劇，半圖與黑底發生率顯著上升；將主因寫成網路，與使用者直覺（「收訊不好」）對齊，**降低對 App「壞掉」的誤解**。
2. **與技術不矛盾**：快門穩定化已盡量吸收裝置差異；若仍失敗，**資源載入不完整**仍是高機率先驗假設，網路為可操作的**外因**。
3. **「重啟 App」作為物理清空緩存**：文案建議 **完全關閉並重新開啟 App**，對應工程上 **行程級** 釋放 WebView／GPU 上下文，比僅「滑掉後台」更徹底；在無法要求使用者清資料的前提下，這是 **最低成本、最高覆蓋** 的「緩存粘滯」排除手段。

**注意**：此為 **UX 與支援成本** 的權衡，並非否定 GPU/WebView 本身問題；內部除錯仍應依 log 與九宮格驗收結果區分「管線失敗」與「純裁切失敗」。

---

## 5. 未來維護建議 (Maintenance Advice)

1. **成功率回退時優先順序**  
   - **第一調**：**`NATIVE_SHUTTER_DOM_WAIT_MS`**（250 → 300～400ms 小步嘗試）。過長會拖慢體驗，需與成功率權衡。  
   - **第二調**：九宮格 **採樣密度**（例如由 3×3 擴為 4×4 或增加邊緣帶狀採樣）；需同步調整 `HAMMER_MAX_DEAD_PIXELS` 等閾值，避免過敏。  
   - **第三調**：重試次數與 `NATIVE_AFTER_FAIL*` 間隔（僅在確認非使用者誤觸連點後再拉長）。

2. **禁止的倒退（Regression）**  
   - 不要在原生路徑 **遮罩未隱藏** 時呼叫 `Screenshot.take()`。  
   - 不要省略 **`waitForCardImagesPaintReady`** 或改為固定極短 `setTimeout` 取代輪詢（弱網必炸）。  
   - 不要在首拍前對全卡執行 **`aggressiveDisplayIcebreak`**（除非實機證明必要），以免閃爍與無謂 layout thrash。

3. **文件與程式同步**  
   - 修改 `BattleCard.jsx` 內上述常數時，**更新本文件 §3 表格** 與版本紀錄（可於 PR 註明實機型號與成功率）。

4. **相關流程**  
   - 廣告解鎖後存相簿：**`VotingArena`** 應 **`await saveToGallery()`** 後再執行解鎖 callback，避免中間狀態觸發多餘重繪與殘留 UI（見該檔註解）。

---

## 修訂紀錄

| 日期 | 摘要 |
|------|------|
| 2026-03-23 | 初版：沉澱 Phase 8 階梯式管線、Hammer 常數與 UX 策略，作為原生–網頁同步災難之 SOP |
