/**
 * Google 登入服務 — 依平台選擇流程
 *
 * - 原生 (Android/iOS)：使用 @capgo/capacitor-social-login 取得 idToken，
 *   再以 GoogleAuthProvider.credential(idToken) 交給 Firebase 驗證，避免 WebView 中
 *   signInWithRedirect/signInWithPopup 失效。
 * - Web：維持 Firebase signInWithPopup。
 *
 * 依賴：auth、googleProvider 來自 firebase.js；Capacitor 僅在原生時使用。
 */
import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import {
  signInWithPopup,
  signInWithCredential,
  reauthenticateWithCredential,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";

const GOOGLE_SCOPES = ["email", "profile"];

/** 是否在原生容器內（Android/iOS） */
export function isNativePlatform() {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios";
}

/** 取得 Google Web Client ID（用於原生插件初始化，與 Firebase 專案一致） */
function getGoogleWebClientId() {
  const id = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!id && import.meta.env.DEV) {
    console.warn(
      "[GoogleAuthService] VITE_GOOGLE_WEB_CLIENT_ID 未設定，原生 Google 登入可能失敗。請在 .env 填入 Firebase 專案的 Web 用戶端 ID。"
    );
  }
  return id || "";
}

let nativeInitialized = false;

/** 僅在原生平台初始化 SocialLogin（Google）；可重複呼叫，內部會只執行一次 */
async function ensureNativeGoogleInitialized() {
  if (!isNativePlatform() || nativeInitialized) return;
  const webClientId = getGoogleWebClientId();
  if (!webClientId) {
    throw new Error(
      "VITE_GOOGLE_WEB_CLIENT_ID 未設定，無法在原生環境使用 Google 登入"
    );
  }
  await SocialLogin.initialize({
    google: {
      webClientId,
      mode: "online",
    },
  });
  nativeInitialized = true;
}

/**
 * 使用 Google 登入並與 Firebase Auth 綁定
 * - 原生：SocialLogin.login('google') → idToken → signInWithCredential
 * - Web：signInWithPopup
 */
export async function loginWithGoogleForFirebase() {
  if (!auth || !googleProvider) {
    throw new Error("Firebase Auth 未就緒");
  }

  if (isNativePlatform()) {
    await ensureNativeGoogleInitialized();
    const { result } = await SocialLogin.login({
      provider: "google",
      options: { scopes: GOOGLE_SCOPES },
    });
    const idToken = result?.idToken ?? null;
    if (!idToken) {
      const msg =
        result?.responseType === "cancel"
          ? "使用者取消登入"
          : "無法取得 Google ID Token";
      throw new Error(msg);
    }
    const credential = GoogleAuthProvider.credential(idToken);
    return signInWithCredential(auth, credential);
  }

  return signInWithPopup(auth, googleProvider);
}

/**
 * 取得當前 Google idToken（用於重新驗證等）
 * 僅在原生平台有意義；Web 可改用 reauthenticateWithPopup。
 */
export async function getGoogleIdTokenForReauth() {
  if (!isNativePlatform()) return null;
  await ensureNativeGoogleInitialized();
  const { result } = await SocialLogin.login({
    provider: "google",
    options: { scopes: GOOGLE_SCOPES },
  });
  return result?.idToken ?? null;
}

/**
 * 以 Google credential 重新驗證當前使用者（例如刪除帳號前）。
 * 僅在原生平台有效；Web 請由呼叫端使用 reauthenticateWithPopup。
 */
export async function reauthenticateWithGoogleCredential(firebaseUser) {
  if (!auth || !firebaseUser) {
    throw new Error("需要已登入的 Firebase 使用者");
  }
  if (!isNativePlatform()) {
    return null;
  }
  const idToken = await getGoogleIdTokenForReauth();
  if (!idToken) throw new Error("無法取得 Google ID Token 以重新驗證");
  const credential = GoogleAuthProvider.credential(idToken);
  return reauthenticateWithCredential(firebaseUser, credential);
}
