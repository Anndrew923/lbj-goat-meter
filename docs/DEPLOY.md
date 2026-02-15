# GOAT Meter — 環境部署與 CI/CD 指引

## 1. 本地環境變數（Firebase）— 顯式配置，不依賴 init.json

本專案以**環境變數**手動建構 Firebase 設定，不使用 Hosting 的 `/__/firebase/init.json`，利於多環境與自架部署。

1. 複製 **`.env.local.example`** 為 **`.env.local`**（或使用 `.env`；Vite 會載入，`.env.local` 優先且不進版控）。
2. 至 [Firebase Console](https://console.firebase.google.com) → 專案 → 專案設定 → 一般 → 您的應用程式，取得 Web 應用程式設定。
3. 將下列變數填入 `.env.local`（**勿提交 `.env.local` 至 Git**，已列於 `.gitignore`）：

```env
VITE_FIREBASE_API_KEY=你的 API Key
VITE_FIREBASE_AUTH_DOMAIN=你的專案.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案 ID
VITE_FIREBASE_STORAGE_BUCKET=你的專案.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=數字
VITE_FIREBASE_APP_ID=你的 App ID
```

4. 在 Firebase Console 啟用 **Authentication**（Google 登入）與 **Firestore**。
5. 若出現 Firestore「client is offline」或戰區卡死：開發時 Console 會印出 `Firebase Project ID: xxx`，請核對與 Console 專案 ID **完全一致**（差一個字母都會導致離線）。

---

## 1.5 網域授權檢查（Authorized domains）

Google 登入與 redirect 白名單依「授權網域」判斷，未列入的網域無法完成登入。

- 至 Firebase Console → **Authentication** → **設定** → **已授權的網域**。
- 確認已包含：
  - **localhost**（本地開發；僅填 `localhost` 即可，不需填 port，`localhost:5173` 等會一併涵蓋。開發伺服器預設 port 為 5173）。
  - 正式環境網域（例如 `your-app.netlify.app` 或自訂網域）。
- 若使用自訂 `authDomain`，該網域也須在授權清單內。
- 若本地登入仍失敗，請再次確認此清單中是否有 **localhost**。

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

## 2.5 部署 Hosting（選用）

目前登入流程採用 **signInWithPopup**（彈窗），不會導向 `firebaseapp.com` 頁面，因此**本地開發不會再出現 `/__/firebase/init.json` 404**。若你之後改為 signInWithRedirect 或需在 `*.firebaseapp.com` 上提供靜態資源，可部署 Hosting：

1. 建置：`npm run build`
2. 部署：`firebase deploy --only hosting`

---

## 3. Netlify 部署

1. 在 [Netlify](https://app.netlify.com) 選擇 **Add new site → Import an existing project**，連接 GitHub 倉庫 `lbj-goat-meter`。
2. 建置設定會依 `netlify.toml` 自動帶入（`npm run build`、`publish: dist`）。
3. 在 Netlify 站台 → **Site configuration → Environment variables** 新增與本地相同的六個變數（`VITE_FIREBASE_*`），以便正式環境連線 Firebase。

---

## 4. 首次檢查清單

- [ ] `.env.local`（或 `.env`）已填入 `VITE_FIREBASE_*`，且 Firebase Console 已啟用 Authentication（Google）
- [ ] Authentication → 設定 → 已授權的網域 已包含 **localhost** 與正式環境網域
- [ ] Google 登入彈窗能正常彈出並完成回傳（本地不應再出現 init.json 404）
- [ ] 定位功能（GPS/IP）能識別當前城市
- [ ] PulseMap 全球地圖正確渲染（無數據時為灰階）
