/**
 * Apple 登入服務（iOS 初始占位）
 *
 * 設計意圖：
 * - 先建立與 GoogleAuthService 平行的服務邊界，讓 AuthContext 對外 API 可穩定擴充。
 * - 目前僅提供受控錯誤，避免在尚未接入 provider 前誤觸發不明行為。
 */

/**
 * Apple Sign-in 與 Firebase 綁定（占位）。
 * 後續接入時建議流程：
 * 1) iOS 原生取得 identityToken / nonce
 * 2) 以 Firebase OAuthProvider('apple.com') 建立 credential
 * 3) signInWithCredential(auth, credential)
 */
export async function loginWithAppleForFirebase() {
  const err = new Error("apple-signin-not-implemented");
  err.code = "auth/apple-signin-not-implemented";
  throw err;
}
