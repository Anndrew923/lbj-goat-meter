/**
 * AuthContext — 全域認證與權限狀態
 *
 * 設計意圖：為何將認證邏輯與金流權限（Entitlement）放在 Context 層？
 * 1. 單一真相來源：登入狀態與 isPremium 由一處維護，避免各頁面重複呼叫 Firebase Auth / 金流 API。
 * 2. 保護路由與 UI 一致：需登入或需 Premium 的頁面可直接依 currentUser / isPremium 決定導向或遮罩。
 * 3. 為後續「通用金流模組」預留接口：金流模組僅需在登入後寫入/更新 Context 的 isPremium，
 *    業務組件只消費 Context，不直接依賴金流實作，符合解耦與可測試性。
 *
 * profiles/{uid} 實時監聽（onSnapshot）：
 * - 登入後訂閱單一文件，資料庫一有資料即更新 profile / hasProfile，供戰區等組件無縫顯示。
 * - 登出或 uid 變更時必須取消訂閱並清除冷卻計時器，避免訂閱殘留或訂閱到舊 uid。
 *
 * 潛在影響：Context 變動會觸發所有訂閱組件 re-render，若未來用戶對象欄位增多，
 *          可考慮將 isPremium / profile 拆成獨立 Context 以縮小影響範圍。
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
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, googleProvider, db, isFirebaseReady } from "../lib/firebase";
import {
  loginWithGoogleForFirebase,
  isNativePlatform,
  reauthenticateWithGoogleCredential,
} from "../services/GoogleAuthService";
import { loginWithAppleForFirebase } from "../services/AppleAuthService";
import { deleteAccountData } from "../services/AccountService";
import { requestResetAdRewardToken } from "../services/RewardedAdsService";
import { callResetPosition } from "../services/ResetPositionService";
import { getRecaptchaToken } from "../services/RecaptchaService";
import { getCallableDetailsCode } from "../utils/firebaseCallableError";
import { trackCompleteRegistration } from "../services/MetaAnalyticsService";
import { triggerHaptic } from "../utils/hapticUtils";
import i18n from "../i18n/config";
import { ensureAvatarInStorage } from "../services/AvatarService";

const AuthContext = createContext(null);

/** 連線冷卻期：auth 穩定後延遲再打 Firestore，避免「client is offline」 */
const FIREBASE_COOLING_MS = 500;
/** 離線時重試取得 isPremium 的延遲（ms） */
const IS_PREMIUM_RETRY_DELAY_MS = 1000;
const IS_PREMIUM_RETRY_MAX = 2;
function isTokenServiceBlockedError(err) {
  const msg = err?.message ?? "";
  return (
    msg.includes("API_KEY_SERVICE_BLOCKED") ||
    (msg.includes("securetoken.googleapis.com") && msg.includes("blocked"))
  );
}
/** Callable 前先強制刷新 Auth token，避免 UI 已登入但 request.auth 為空的漂移狀態。 */
async function ensureFreshAuthTokenForCallable() {
  if (!auth?.currentUser) return false;
  await auth.currentUser.getIdToken(true);
  return true;
}

async function fetchIsPremium(uid) {
  if (!db) return false;
  const profileRef = doc(db, "profiles", uid);
  try {
    const snap = await getDocFromCache(profileRef);
    if (snap.exists()) return snap.data()?.isPremium === true;
  } catch {
    // 緩存無此文件或未啟用持久化，改向伺服器請求
  }
  const snap = await getDoc(profileRef);
  return snap.exists() && snap.data()?.isPremium === true;
}

/** 將 Firebase Auth 錯誤碼轉成使用者可讀訊息（依當前語系） */
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
  // APK/WebView：Capacitor androidScheme 為 https 時，Firebase 請求 referer 為 https://localhost，若 GCP API 金鑰未允許會被擋
  const msg = err?.message ?? "";
  if (
    code === "auth/requests-from-referer-https://localhost-are-blocked" ||
    (msg.includes("referer") && msg.includes("localhost"))
  ) {
    return i18n.t("common:authError_refererBlocked");
  }
  return err?.message ?? i18n.t("common:authError_loginFailed");
}

/** 開發環境：依錯誤碼在 Console 輸出診斷提示，方便對齊 .env 與 Firebase Console */
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
        ? "→ 到 Firebase Console > Authentication > Settings > Authorized domains，加入目前網域（如 localhost 或 127.0.0.1）"
        : refererBlocked
          ? "→ APK/WebView 請求 referer 為 https://localhost：到 Google Cloud Console > APIs & Services > Credentials > 選取本專案 API 金鑰 > 應用程式限制 > HTTP referrers，加入 https://localhost 與 https://localhost/*（詳見 docs/APK_GOOGLE_LOGIN_FIX.md）"
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
  /** 匿名觀察者狀態：true 表示以匿名觀察者進入，可瀏覽 /vote 但不可投票 */
  const [isGuest, setIsGuest] = useState(false);
  /** profiles/{uid} 文件：實時監聽，資料庫一出現即更新，供戰區無縫顯示投票 UI [cite: 2026-02-11] */
  const [profile, setProfile] = useState(null);
  /** 在已登入但尚未收到第一筆 profile snapshot 前為 true，避免戰區誤判為「未登錄」 */
  const [profileLoading, setProfileLoading] = useState(false);
  const retryTimeoutRef = useRef(null);
  const coolingTimeoutRef = useRef(null);
  const profileUnsubscribeRef = useRef(null);
  /** 已處理過完整 Auth+Profile 訂閱流程的 UID；同 UID 重入時嚴禁清空 profile，避免 APK/WebView 閃爍 */
  const lastAuthUidRef = useRef(null);

  const refreshEntitlements = useCallback(async () => {
    if (!currentUser?.uid) return;
    const isPremium = await fetchIsPremium(currentUser.uid);
    setCurrentUser((prev) => (prev ? { ...prev, isPremium } : null));
  }, [currentUser?.uid]);

  // 僅在 Firebase 已就緒時訂閱 Auth 狀態，避免在 init 失敗或未設定時呼叫 getAuth() 導致掛起
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
        if (coolingTimeoutRef.current) {
          clearTimeout(coolingTimeoutRef.current);
          coolingTimeoutRef.current = null;
        }
        if (profileUnsubscribeRef.current) {
          profileUnsubscribeRef.current();
          profileUnsubscribeRef.current = null;
        }
        setProfile(null);
        setProfileLoading(false);
        setCurrentUser(null);
        setIsGuest(false);
        setLoading(false);
        return;
      }
      (async () => {
        // 先寫入 user，避免彈窗關閉後 UI 仍等 Firestore；如有需要則嘗試將 Google 頭像鏡像到 Firebase Storage
        let effectivePhotoURL = user.photoURL || null;
        let mirroredProfilePhotoURL = null;
        try {
          mirroredProfilePhotoURL = await ensureAvatarInStorage({
            uid: user.uid,
            photoURL: user.photoURL,
          });
          if (mirroredProfilePhotoURL) {
            effectivePhotoURL = mirroredProfilePhotoURL;
          }
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[AuthContext] ensureAvatarInStorage failed:", err);
          }
        }

        // 鏡像成功後將 Storage 下載網址寫入 profiles，供離線／多端與後台查核；setDoc+merge 兼容文件尚未建立
        if (mirroredProfilePhotoURL && db) {
          try {
            await setDoc(
              doc(db, "profiles", user.uid),
              {
                photoURL: mirroredProfilePhotoURL,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          } catch (persistErr) {
            if (import.meta.env.DEV) {
              console.warn(
                "[AuthContext] persist profile photoURL failed:",
                persistErr,
              );
            }
          }
        }

        const nextUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: effectivePhotoURL,
          isPremium: false,
        };
        // 同 UID 重入（token 更新、前後台恢復）：禁止清空 profile / 重設 loading，由既有 onSnapshot 持續覆寫
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
        // Firestore 階梯讀取需 request.auth；訪客改走匿名登入，isGuest 仍表示「僅觀察、不可投票」
        setIsGuest(user.isAnonymous === true);
        setLoading(false);
        setProfile(null);
        setProfileLoading(true);
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

        if (!db) {
          setProfileLoading(false);
          return;
        }
        // 連線冷卻期：auth 穩定後再訂閱 Firestore，避免觸發瞬間 client is offline
        coolingTimeoutRef.current = setTimeout(() => {
          coolingTimeoutRef.current = null;
          if (profileUnsubscribeRef.current) {
            profileUnsubscribeRef.current();
            profileUnsubscribeRef.current = null;
          }
          const profileRef = doc(db, "profiles", user.uid);
          profileUnsubscribeRef.current = onSnapshot(
            profileRef,
            (snap) => {
              const data = snap.exists() ? snap.data() : null;
              setProfile(data);
              setProfileLoading(false);
              setCurrentUser((prev) => {
                if (prev?.uid !== user.uid) return prev;
                return { ...prev, isPremium: data?.isPremium === true };
              });
            },
            (err) => {
              if (import.meta.env.DEV) {
                console.warn(
                  "[AuthContext] profile onSnapshot 錯誤:",
                  err?.message ?? err,
                );
              }
              setProfileLoading(false);
            },
          );
          // 保留原有 isPremium 重試邏輯（離線時 onSnapshot 可能延遲）
          const tryFetchPremium = (retryCount = 0) => {
            fetchIsPremium(user.uid)
              .then((isPremium) => {
                setCurrentUser((prev) =>
                  prev?.uid === user.uid ? { ...prev, isPremium } : prev,
                );
              })
              .catch((err) => {
                if (import.meta.env.DEV) {
                  console.warn(
                    "[AuthContext] 取得 isPremium 失敗:",
                    err?.message ?? err,
                  );
                }
                const isOffline = err?.message?.includes("offline") ?? false;
                if (
                  (isOffline || err?.code === "unavailable") &&
                  retryCount < IS_PREMIUM_RETRY_MAX
                ) {
                  retryTimeoutRef.current = setTimeout(
                    () => tryFetchPremium(retryCount + 1),
                    IS_PREMIUM_RETRY_DELAY_MS,
                  );
                }
              });
          };
          tryFetchPremium();
        }, FIREBASE_COOLING_MS);
      })();
    });
    return () => {
      if (coolingTimeoutRef.current) clearTimeout(coolingTimeoutRef.current);
      coolingTimeoutRef.current = null;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
      if (profileUnsubscribeRef.current) {
        profileUnsubscribeRef.current();
        profileUnsubscribeRef.current = null;
      }
      unsubscribe();
    };
  }, []);

  // 原生 (Android/iOS)：使用 SocialLogin 取得 idToken，再以 credential 與 Firebase 驗證，避免 WebView 中 signInWithRedirect/popup 失效。
  // Web：維持 signInWithPopup。
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
   * 目前僅提供受控錯誤與統一錯誤回寫路徑，確保未接 provider 前不影響既有 Google/Guest 流程。
   */
  const loginWithApple = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth) {
      triggerHaptic([30, 50, 30]);
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] Firebase 未就緒，無法執行 Apple 登入");
      }
      return;
    }
    try {
      await loginWithAppleForFirebase();
    } catch (err) {
      triggerHaptic([30, 50, 30]);
      // iOS 初始階段：Apple provider 尚未接線時，先走受控錯誤，避免污染既有 Google 錯誤語意。
      const isNotImplemented =
        err?.code === "auth/apple-signin-not-implemented" ||
        err?.message === "apple-signin-not-implemented";
      const message = isNotImplemented
        ? i18n.t("common:authError_loginFailed")
        : getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] Apple 登入失敗:", err?.code ?? err?.message);
      }
      throw err;
    }
  }, []);

  /**
   * 以匿名觀察者身份進入：使用 Firebase Anonymous Auth，使 Firestore 規則之 isAuthenticated() 成立；
   * isGuest 仍由 onAuthStateChanged 依 user.isAnonymous 同步，供 UI 禁止投票。
   */
  const continueAsGuest = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth) {
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] Firebase 未就緒，無法匿名登入");
      }
      throw new Error("firebase-not-ready");
    }
    try {
      await signInAnonymously(auth);
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV) {
        console.warn("[AuthContext] 匿名登入失敗:", err?.code ?? err?.message);
      }
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    if (!auth) {
      setCurrentUser(null);
      setIsGuest(false);
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    try {
      await firebaseSignOut(auth);
      setCurrentUser(null);
      setIsGuest(false);
      setProfile(null);
      setProfileLoading(false);
    } catch (err) {
      setAuthError(err?.message ?? i18n.t("common:signOutFailed"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] signOut 失敗:", err?.message);
      throw err;
    }
  }, []);

  /**
   * 帳號刪除：Firestore 全域清理後再刪除 Auth，嚴禁留下孤兒數據。
   * 若 Firebase 回傳 requires-recent-login，先以 reauthenticateWithPopup 引導用戶重新驗證再執行刪除。
   * 刪除成功後清空所有 Context 狀態；嚴禁 window.location.reload()，依 i18n 與狀態更新即可。
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
      setProfile(null);
      setProfileLoading(false);
      setIsGuest(false);
      if (import.meta.env.DEV) {
        console.log("[AuthContext] 帳號已刪除，狀態已清空，不再自動重載");
      }
    } catch (err) {
      const code = err?.code ?? "";
      if (code === "auth/requires-recent-login") {
        try {
          if (isNativePlatform()) {
            await reauthenticateWithGoogleCredential(auth.currentUser);
          } else {
            await reauthenticateWithPopup(auth.currentUser, googleProvider);
          }
          // Firestore 已在上一 try 中清理，此處僅需執行 Auth 刪除
          await deleteUser(auth.currentUser);
          setCurrentUser(null);
          setProfile(null);
          setProfileLoading(false);
          setIsGuest(false);
          if (import.meta.env.DEV) {
            console.log(
              "[AuthContext] 重新驗證後帳號已刪除，狀態已清空，不再自動重載",
            );
          }
        } catch (reauthErr) {
          const msg = getAuthErrorMessage(reauthErr);
          setAuthError(msg);
          if (import.meta.env.DEV) {
            console.warn(
              "[AuthContext] 重新驗證或刪除失敗:",
              reauthErr?.message,
            );
          }
          throw reauthErr;
        }
      } else {
        const msg = err?.message ?? i18n.t("common:deleteAccountFailed");
        setAuthError(msg);
        if (import.meta.env.DEV) {
          console.warn("[AuthContext] deleteAccount 失敗:", err?.message);
        }
        throw err;
      }
    }
  }, [currentUser?.uid]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  /** 重新投票：透過廣告獎勵與 Cloud Function resetPosition 清除當前立場；resetProfile 僅作為 UI 選項，後端保留擴充空間。 */
  const revote = useCallback(
    async (resetProfile = false) => {
      const uid = currentUser?.uid;
      if (!uid) {
        const msg = i18n.t("common:error_missingDbOrUid");
        setAuthError(msg);
        throw new Error(msg);
      }
      setAuthError(null);
      try {
        // 先刷新一次 token，降低「看起來已登入但 callable 無 auth」的誤判。
        await ensureFreshAuthTokenForCallable();

        // 1. 先透過 Rewarded Ads 取得廣告獎勵 Token；使用者若中途關閉，丟出 ad-not-watched。
        const adRewardToken = await requestResetAdRewardToken();

        // 2. 與後端 payload 一致可帶 reCAPTCHA token（目前 reset 後端未強制驗證分數）。
        const recaptchaToken = await getRecaptchaToken("reset_position");

        // 3. 呼叫 Cloud Function resetPosition（Golden Key、廣告獎勵／允許 origin 等）。
        let resetResult;
        try {
          resetResult = await callResetPosition({
            adRewardToken,
            recaptchaToken,
          });
        } catch (firstErr) {
          const firstBackendCode = getCallableDetailsCode(firstErr);
          if (firstBackendCode !== "auth-required") {
            throw firstErr;
          }
          // 若 token 於廣告流程中失效，先強制刷新後以同一組廣告 token 重試一次，避免要求使用者重整頁面。
          await ensureFreshAuthTokenForCallable();
          resetResult = await callResetPosition({
            adRewardToken,
            recaptchaToken,
          });
        }

        const { deletedVoteId } = resetResult;

        if (import.meta.env.DEV) {
          console.log(
            "[AuthContext] resetPosition 完成 — deletedVoteId:",
            deletedVoteId
          );
        }

        // resetProfile 目前僅作為 UI 勾選項目，後端尚未擴充欄位重置；未來可在此追加 profiles 重設流程。
      } catch (err) {
        const backendCode = getCallableDetailsCode(err);

        let msg;
        if (backendCode === "auth-required") {
          msg = i18n.t("common:voteError_authRequired");
        } else if (isTokenServiceBlockedError(err)) {
          msg = i18n.t("common:voteError_tokenServiceBlocked");
        } else if (backendCode === "low-score-robot") {
          msg = i18n.t("common:voteError_lowScoreRobot");
        } else if (backendCode === "device-already-voted") {
          msg = i18n.t("common:voteError_deviceAlreadyVoted");
        } else if (backendCode === "ad-not-watched") {
          msg = i18n.t("common:voteError_adNotWatched");
        } else if (backendCode === "reset-internal") {
          msg = i18n.t("common:voteError_resetInternal");
        } else if (
          backendCode === "signature-missing" ||
          backendCode === "signature-mismatch" ||
          backendCode === "signature-invalid-timestamp" ||
          backendCode === "signature-timestamp-skew"
        ) {
          msg = i18n.t("common:revoteSignatureError");
        } else {
          msg = i18n.t("common:voteError_genericRetry");
        }

        setAuthError(msg);
        if (import.meta.env.DEV) {
          console.warn("[AuthContext] revote/resetPosition 失敗:", {
            code: backendCode,
            message: err?.message,
          });
        }
        throw new Error(msg);
      }
    },
    [currentUser?.uid],
  );

  /** 有完成戰區登錄：profile 存在且未標記為需重設（hasProfile !== false） */
  const hasProfile = Boolean(profile && profile.hasProfile !== false);

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      authError,
      isGuest,
      profile,
      profileLoading,
      hasProfile,
      loginWithGoogle,
      loginWithApple,
      continueAsGuest,
      signOut,
      deleteAccount,
      clearAuthError,
      refreshEntitlements,
      revote,
    }),
    [
      currentUser,
      loading,
      authError,
      isGuest,
      profile,
      profileLoading,
      hasProfile,
      loginWithGoogle,
      loginWithApple,
      continueAsGuest,
      signOut,
      deleteAccount,
      clearAuthError,
      refreshEntitlements,
      revote,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx == null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
