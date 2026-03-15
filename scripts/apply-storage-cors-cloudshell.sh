#!/bin/bash
# 在 Google Cloud Shell 執行此腳本（無需本機安裝 gcloud）：
# 1. 開啟 https://console.cloud.google.com → 點右上角「啟動 Cloud Shell」
# 2. 若不知道儲存貯體名稱，先執行：gsutil ls   （會列出 gs://儲存貯體名稱）
# 3. 將下方 BUCKET 改為實際名稱（常見為 lbj-goat-meter.appspot.com）
# 4. 複製本檔全部內容，貼到 Cloud Shell 終端機後按 Enter
set -e
export CLOUDSDK_CORE_PROJECT=lbj-goat-meter
# 若 404，請改為 gsutil ls 列出的名稱（例如 lbj-goat-meter.appspot.com）
BUCKET="lbj-goat-meter.appspot.com"
cat << 'CORSEOF' > /tmp/cors.json
[
  {
    "origin": [
      "http://localhost:2323",
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:2323",
      "http://127.0.0.1:5173"
    ],
    "method": ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "User-Agent",
      "x-goog-resumable",
      "x-goog-meta-*"
    ],
    "maxAgeSeconds": 3600
  }
]
CORSEOF
if gsutil cors set /tmp/cors.json "gs://$BUCKET"; then
  echo "Done. CORS 已套用到 gs://$BUCKET"
else
  echo "套用失敗。請先執行: gsutil ls"
  echo "將輸出的儲存貯體名稱（去掉 gs://）設為 BUCKET 後再執行本腳本。"
  exit 1
fi
