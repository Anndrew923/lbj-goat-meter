# Firebase Storage CORS 設定（突發戰區圖片上傳）

從 **localhost** 或自訂網域上傳圖片到 Firebase Storage 時，若出現：

```
Access to XMLHttpRequest at 'https://firebasestorage.googleapis.com/...' has been blocked by CORS policy
```

表示 Storage 儲存貯體尚未允許該來源，需在 **Google Cloud** 端設定 CORS。

---

## 方式一：Google Cloud Shell（建議，無需本機安裝）

1. 開啟 [Google Cloud Console](https://console.cloud.google.com)，確認左上角專案為 **lbj-goat-meter**。
2. 點右上角 **「啟動 Cloud Shell」**（終端機圖示）。
3. **先查詢實際的儲存貯體名稱**（若已知可略過）：
   ```bash
   gsutil ls
   ```
   輸出會類似 `gs://某個名稱`，記下「某個名稱」（不要含 `gs://`）。常見為 `lbj-goat-meter.appspot.com`。
4. 在 Cloud Shell 中複製貼上以下整段。**若上一步看到的儲存貯體名稱不是 `lbj-goat-meter.appspot.com`，請把下面第二行的 `BUCKET="..."` 改成該名稱**：

```bash
export CLOUDSDK_CORE_PROJECT=lbj-goat-meter
BUCKET="lbj-goat-meter.appspot.com"
cat << 'CORSEOF' > /tmp/cors.json
[
  {
    "origin": ["http://localhost:2323", "http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:2323", "http://127.0.0.1:5173", "https://localhost", "capacitor://localhost", "ionic://localhost", "https://lbj-goat-meter.web.app", "https://lbj-goat-meter.firebaseapp.com"],
    "method": ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization", "Content-Length", "User-Agent", "x-goog-resumable", "x-goog-meta-*"],
    "maxAgeSeconds": 3600
  }
]
CORSEOF
gsutil cors set /tmp/cors.json "gs://$BUCKET" && echo "Done. CORS 已套用到 gs://$BUCKET" || (echo "失敗。請將 BUCKET 改為 gsutil ls 顯示的名稱後重試。" && exit 1)
```

5. 看到 `Done. CORS 已套用到 gs://...` 後，回到 localhost 後台再試一次發布（含圖片）即可。

---

## 方式二：本機 gsutil（已安裝 Google Cloud SDK 時）

```bash
gcloud auth login
gcloud config set project lbj-goat-meter
gsutil cors set storage-cors.json gs://你的儲存貯體名稱
```

儲存貯體名稱請到 **Firebase Console > Storage** 或 CORS 錯誤網址中 `/v0/b/` 後方查看。

---

## 方式三：本機 Node 腳本

已安裝依賴且已設定 Google 應用程式預設憑證時：

```bash
npm run storage:cors
```

若出現「bucket does not exist」，請到 Firebase Console > Storage 查看儲存貯體名稱，並設定後再執行：

```bash
STORAGE_BUCKET=你的儲存貯體名稱 npm run storage:cors
```

---

## 驗證

```bash
gsutil cors get gs://你的儲存貯體名稱
```

輸出應與 `storage-cors.json` 內容一致。

---

## 正式環境網域

部署上線後，請編輯 `storage-cors.json`，在 `origin` 陣列中加入正式網域（例如 `https://your-app.netlify.app`），再依上述任一方式重新套用 CORS。

`storage-cors.json` 已含 **Capacitor** 常見來源（`https://localhost` 對應 `androidScheme: https`、`capacitor://localhost` 等），以便 App 內 WebView 以 `crossOrigin="anonymous"` 載入 **Firebase Storage** 圖片時不污染 canvas。若頭像來自 **Google 帳號** 託管網址（非 Storage），CORS 由 Google 端決定；若仍無法匯出，需改為經後端／Storage 轉存同網域圖片。

---

**注意**：CORS 僅影響「瀏覽器」發出的請求；未設定 CORS 前，後台仍可先發布活動（無圖），圖片上傳失敗時會顯示提示。
