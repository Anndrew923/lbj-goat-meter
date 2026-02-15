# GOAT Meter — 環境部署與 CI/CD 指引

## 1. 本地環境變數（Firebase）

1. 複製 `.env.example` 為 `.env`。
2. 至 [Firebase Console](https://console.firebase.google.com) → 專案 → 專案設定 → 一般 → 您的應用程式，取得 Web 應用程式設定。
3. 將下列變數填入 `.env`（勿提交 `.env` 至 Git）：

```env
VITE_FIREBASE_API_KEY=你的 API Key
VITE_FIREBASE_AUTH_DOMAIN=你的專案.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案 ID
VITE_FIREBASE_STORAGE_BUCKET=你的專案.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=數字
VITE_FIREBASE_APP_ID=你的 App ID
```

4. 在 Firebase Console 啟用 **Authentication**（Google 登入）與 **Firestore**。

---

## 2. Firestore 規則與索引部署（CLI）

1. 安裝 Firebase CLI：`npm install -g firebase-tools`
2. 登入：`firebase login`
3. 連結專案（若尚未）：`firebase use --add` 選擇專案。
4. 僅部署 Firestore 規則與索引：

```bash
firebase deploy --only firestore
```

---

## 3. Netlify 部署

1. 在 [Netlify](https://app.netlify.com) 選擇 **Add new site → Import an existing project**，連接 GitHub 倉庫 `lbj-goat-meter`。
2. 建置設定會依 `netlify.toml` 自動帶入（`npm run build`、`publish: dist`）。
3. 在 Netlify 站台 → **Site configuration → Environment variables** 新增與本地相同的六個變數（`VITE_FIREBASE_*`），以便正式環境連線 Firebase。

---

## 4. 首次檢查清單

- [ ] Google 登入能正常喚起
- [ ] 定位功能（GPS/IP）能識別當前城市
- [ ] PulseMap 全球地圖正確渲染（無數據時為灰階）
