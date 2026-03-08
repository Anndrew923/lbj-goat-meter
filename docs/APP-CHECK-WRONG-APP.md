# 可能原因：改錯「應用程式」的 App Check

同一個 Firebase **專案**底下可以有多個**應用程式**（例如多個 Web app）。  
App Check 的 reCAPTCHA 密鑰是**依「應用程式」分開設定**的。  
若你改的是 A 的 App Check，但 Netlify 連的是 B 的 appId，密鑰設再對都不會過。

---

## 請照做一次（約 2 分鐘）

### 1. 看實際連線的是哪一個 App

1. 打開 **Production 站**（例如 https://lbj-goat-meter.netlify.app/）
2. **F12 → Console**
3. 找這行：`[Firebase] 目前連線：projectId = xxx | appId = yyy`
4. 把 **projectId** 和 **appId** 記下來（或截圖）

### 2. 在 Firebase 對「同一個」App 設 App Check

1. 打開 [Firebase Console](https://console.firebase.google.com/) → 選專案（**projectId 要與上面一致**）
2. 左側 **專案設定**（齒輪）→ **您的應用程式**
3. 在「網頁應用程式」清單裡，找到 **App ID 與 Console 顯示的 appId 完全一致** 的那一筆（名稱可能叫 lbj-goat-meter-web 或別的）
4. 左側 **App Check** → 畫面上會列出同專案下的應用程式
5. 點進去 **「那一個」**（App ID 與步驟 1 相同）的 reCAPTCHA 設定，確認密鑰是填在這裡

若你之前改的一直是「另一筆」網頁應用程式（例如有兩個 Web app，改到沒在用的那個），就會出現：金鑰都對、但 401/403 照樣發生。  
只要改對「實際在用的那一個 App」的 App Check，通常就會好。

### 3. 若專案裡只有一個 Web app

若「您的應用程式」裡真的只有一個網頁 app，且 appId 也對得上，代表不是改錯 app 的問題，可以再往別的方向查（例如 Firebase 支援、或暫時用 Debug Token 先讓 Production 能跑，再查 401 根因）。
