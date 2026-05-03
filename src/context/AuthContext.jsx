/**
 * AuthContext — 純 Firebase Auth 身分層
 *
 * 設計意圖（Spotify/Strava 三層分離原則）：
 *   1. 單一職責：只管「你是誰」— uid、email、displayName、photoURL、loading、isGuest。
 *   2. 解耦：「你的資料」→ ProfileContext；「你能做什麼」→ EntitlementContext。
 *   3. 向後相容：useAuth() 複合 Hook 從 hooks/useAuth.js 重新匯出，
 *      所有現有消費者（VotePage、App 等）import 路徑與回傳值完全不變，零修改。
 *
 * setCurrentUser 刻意暴露在 Context value 中，供 ProfileContext 同步 isPremium 欄位
 * （向後相容設計：現有代碼的 currentUser.isPremium 仍可正常讀取）。
 *
 * 頭像鏡像（ensureAvatarInStorage）與首次登錄追蹤留在此層，
 * 因為它們修改 currentUser.photoURL，屬於身分欄位的維護責任。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut as firebaseSignOut,
  deleteUser,
  reauthenticateWithPopup,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, googleProvider, db, isFirebaseReady } from "../lib/firebase";
import {
  loginWithGoogleForFirebase,
  isNativePlatform,
  reauthenticateWithGoogleCredential,
} from "../services/GoogleAuthService";
import { loginWithAppleForFirebase } from "../services/AppleAuthService";
import { deleteAccountData } from "../services/AccountService";
import { trackCompleteRegistration } from "../services/MetaAnalyticsService";
import { triggerHaptic } from "../utils/hapticUtils";
import i18n from "../i18n/config";
import { ensureAvatarInStorage } from "../services/AvatarService";

export const AuthContext = createContext(null);

function isTokenServiceBlockedError(err) {
  const msg = err?.message ?? "";
  return (
    msg.includes("API_KEY_SERVICE_BLOCKED") ||
    (msg.includes("securetoken.googleapis.com") && msg.includes("blocked"))
  );
}

function getAuthErrorMessage(err) {
  const code = err?.code ?? "";
  if (
    code === "auth/configuration-not-found" ||
    err?.message?.includes("CONFIGURATION_NOT_FOUND")
  ) {
    return i18n.t("common:authError_configNotFound");
  }
  if (isTokenServiceBlockedError(err)) {
    return i18n.t("common:authError_tokenServiceBlocked");
  }
  if (code === "auth/unauthorized-domain") {
    return i18n.t("common:authError_unauthorizedDomain");
  }
  if (code === "auth/popup-closed-by-user") {
    return i18n.t("common:authError_popupClosed");
  }
  if (code === "auth/popup-blocked") {
    return i18n.t("common:authError_popupBlocked");
  }
  if (code === "auth/requires-recent-login") {
    return i18n.t("common:authError_requiresRecentLogin");
  }
  const msg = err?.message ?? "";
  if (
    code === "auth/requests-from-referer-https://localhost-are-blocked" ||
    (msg.includes("referer") && msg.includes("localhost"))
  ) {
    return i18n.t("common:authError_refererBlocked");
  }
  return err?.message ?? i18n.t("common:authError_loginFailed");
}

function logAuthErrorDiagnostic(err, context = "登入") {
  if (!import.meta.env.DEV || !err) return;
  const code = err?.code ?? "";
  const refererBlocked =
    code === "auth/requests-from-referer-https://localhost-are-blocked" ||
    (err?.message?.includes("referer") && err?.message?.includes("localhost"));
  const hint =
    code === "auth/configuration-not-found"
      ? "→ 檢查 Firebase Console 已啟用 Google 登入，且 .env 的 API_KEY / AUTH_DOMAIN / PROJECT_ID 與專案設定一致；修改 .env 後需重啟 npm run dev"
      : code === "auth/unauthorized-domain"
        ? "→ 到 Firebase Console > Authentication > Settings > Authorized domains，加入目前網域"
        : refererBlocked
          ? "→ APK/WebView 請求 referer 為 https://localhost：到 GCP API 金鑰限制加入 https://localhost 與 https://localhost/*"
          : code === "auth/popup-blocked"
            ? "→ 允許瀏覽器彈出視窗，或改用 signInWithRedirect"
            : null;
  if (hint) {
    console.warn(`[AuthContext] ${context} 失敗 (${code})，診斷:`, hint);
  }
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  /** 已處理過的 UID；同 UID 重入時只更新可變欄位，不重置 loading 狀態 */
  const lastAuthUidRef = useRef(null);

  useEffect(() => {
    if (!isFirebaseReady || !auth) {
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthError(null);
      if (!user) {
        lastAuthUidRef.current = null;
        setCurrentUser(null);
        setIsGuest(false);
        setLoading(false);
        return;
      }
      (async () => {
        // 先寫入 currentUser，讓 UI 立即感知登入狀態；avatar 鏡像非阻塞
        let effectivePhotoURL = user.photoURL || null;
        let mirroredProfilePhotoURL = null;
        try {
          mirroredProfilePhotoURL = await ensureAvatarInStorage({
            uid: user.uid,
            photoURL: user.photoURL,
          });
          if (mirroredProfilePhotoURL) effectivePhotoURL = mirroredProfilePhotoURL;
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[AuthContext] ensureAvatarInStorage failed:", err);
          }
        }

        // 鏡像成功後持久化至 profiles，供離線/多端/後台查核
        if (mirroredProfilePhotoURL && db) {
          try {
            await setDoc(
              doc(db, "profiles", user.uid),
              { photoURL: mirroredProfilePhotoURL, updatedAt: serverTimestamp() },
              { merge: true },
            );
          } catch (persistErr) {
            if (import.meta.env.DEV) {
              console.warn("[AuthContext] persist profile photoURL failed:", persistErr);
            }
          }
        }

        const nextUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: effectivePhotoURL,
          isPremium: false, // ProfileContext 的 onSnapshot 會覆寫此欄位
        };

        // 同 UID 重入（token 刷新、前後台恢復）：只更新可變欄位，不重設 loading
        if (lastAuthUidRef.current === user.uid) {
          setCurrentUser((prev) =>
            prev?.uid === user.uid
              ? {
                  ...prev,
                  email: user.email ?? prev.email,
                  displayName: user.displayName ?? prev.displayName,
                  photoURL: effectivePhotoURL ?? prev.photoURL,
                }
              : nextUser,
          );
          setIsGuest(user.isAnonymous === true);
          setLoading(false);
          return;
        }

        lastAuthUidRef.current = user.uid;
        setCurrentUser(nextUser);
        setIsGuest(user.isAnonymous === true);
        setLoading(false);

        // 首次登錄完整追蹤（Meta CAPI）
        const isFirstRegistration =
          user?.metadata?.creationTime &&
          user?.metadata?.lastSignInTime &&
          user.metadata.creationTime === user.metadata.lastSignInTime;
        if (!user.isAnonymous && isFirstRegistration) {
          const trackedKey = `meta_complete_registration_${user.uid}`;
          const trackedBefore =
            typeof window !== "undefined" &&
            window.localStorage.getItem(trackedKey) === "1";
          if (!trackedBefore) {
            trackCompleteRegistration({
              registrationMethod: "google",
              userId: user.uid,
            }).then((tracked) => {
              if (tracked && typeof window !== "undefined") {
                window.localStorage.setItem(trackedKey, "1");
              }
            });
          }
        }
      })();
    });
    return () => unsubscribe();
  }, []);

  // 原生平台使用 SocialLogin credential；Web 維持 signInWithPopup
  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth || !googleProvider) {
      triggerHaptic([30, 50, 30]);
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] Firebase 未就緒，無法執行登入");
      throw new Error("auth/firebase-not-ready");
    }
    try {
      await loginWithGoogleForFirebase();
    } catch (err) {
      triggerHaptic([30, 50, 30]);
      const message = getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] Google 登入失敗:", err?.code ?? err?.message);
        logAuthErrorDiagnostic(err, "Google 登入");
      }
      throw err;
    }
  }, []);

  /**
   * Apple Sign-in（iOS 戰線預留）
   * 受控錯誤路徑確保未接 provider 前不影響 Google/Guest 流程
   */
  const loginWithApple = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth) {
      triggerHaptic([30, 50, 30]);
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] Firebase 未就緒，無法執行 Apple 登入");
      return;
    }
    try {
      await loginWithAppleForFirebase();
    } catch (err) {
      triggerHaptic([30, 50, 30]);
      const isNotImplemented =
        err?.code === "auth/apple-signin-not-implemented" ||
        err?.message === "apple-signin-not-implemented";
      const message = isNotImplemented
        ? i18n.t("common:authError_loginFailed")
        : getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV)
        console.warn("[AuthContext] Apple 登入失敗:", err?.code ?? err?.message);
      throw err;
    }
  }, []);

  /**
   * 匿名觀察者：使用 Firebase Anonymous Auth 讓 Firestore 規則的 isAuthenticated() 成立；
   * isGuest 由 onAuthStateChanged 依 user.isAnonymous 同步，UI 據此禁止投票。
   */
  const continueAsGuest = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth) {
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] Firebase 未就緒，無法匿名登入");
      throw new Error("firebase-not-ready");
    }
    try {
      await signInAnonymously(auth);
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV)
        console.warn("[AuthContext] 匿名登入失敗:", err?.code ?? err?.message);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    if (!auth) {
      setCurrentUser(null);
      setIsGuest(false);
      return;
    }
    try {
      await firebaseSignOut(auth);
      setCurrentUser(null);
      setIsGuest(false);
    } catch (err) {
      setAuthError(err?.message ?? i18n.t("common:signOutFailed"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] signOut 失敗:", err?.message);
      throw err;
    }
  }, []);

  /**
   * 帳號刪除：先清理 Firestore 全域資料，再刪除 Auth。
   * requires-recent-login：先 reauth 再重試；刪除後清空 Context 狀態。
   * 不呼叫 window.location.reload()，由響應式狀態驅動 UI 更新。
   */
  const deleteAccount = useCallback(async () => {
    const uid = currentUser?.uid;
    if (!auth || !uid) {
      setAuthError(i18n.t("common:noUserForDelete"));
      return;
    }
    setAuthError(null);
    try {
      await deleteAccountData(uid);
      await deleteUser(auth.currentUser);
      setCurrentUser(null);
      setIsGuest(false);
      if (import.meta.env.DEV)
        console.log("[AuthContext] 帳號已刪除，狀態已清空");
    } catch (err) {
      const code = err?.code ?? "";
      if (code === "auth/requires-recent-login") {
        try {
          if (isNativePlatform()) {
            await reauthenticateWithGoogleCredential(auth.currentUser);
          } else {
            await reauthenticateWithPopup(auth.currentUser, googleProvider);
          }
          await deleteUser(auth.currentUser);
          setCurrentUser(null);
          setIsGuest(false);
          if (import.meta.env.DEV)
            console.log("[AuthContext] 重新驗證後帳號已刪除");
        } catch (reauthErr) {
          const msg = getAuthErrorMessage(reauthErr);
          setAuthError(msg);
          if (import.meta.env.DEV)
            console.warn("[AuthContext] 重新驗證或刪除失敗:", reauthErr?.message);
          throw reauthErr;
        }
      } else {
        const msg = err?.message ?? i18n.t("common:deleteAccountFailed");
        setAuthError(msg);
        if (import.meta.env.DEV)
          console.warn("[AuthContext] deleteAccount 失敗:", err?.message);
        throw err;
      }
    }
  }, [currentUser?.uid]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      authError,
      isGuest,
      /** setCurrentUser 供 ProfileContext 同步 isPremium，不對外消費者暴露 */
      setCurrentUser,
      loginWithGoogle,
      loginWithApple,
      continueAsGuest,
      signOut,
      deleteAccount,
      clearAuthError,
    }),
    [
      currentUser,
      loading,
      authError,
      isGuest,
      loginWithGoogle,
      loginWithApple,
      continueAsGuest,
      signOut,
      deleteAccount,
      clearAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (ctx == null)
    throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}

/**
 * useAuth — 向後相容複合 Hook（重新匯出）
 * 合併 AuthContext + ProfileContext + EntitlementContext 的完整 API，
 * 使所有現有組件 import 路徑不需改動。
 * 新組件請改用 useAuthContext() / useProfile() / useEntitlement() 獲取更細粒度的訂閱。
 */
export { useAuth } from "../hooks/useAuth";
