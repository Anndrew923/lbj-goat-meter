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
  signInWithPopup,
  signOut as firebaseSignOut,
  deleteUser,
  reauthenticateWithPopup,
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, db, isFirebaseReady } from "../lib/firebase";
import { deleteAccountData, revokeVote } from "../services/AccountService";
import i18n from "../i18n/config";

const AuthContext = createContext(null);

/** 連線冷卻期：auth 穩定後延遲再打 Firestore，避免「client is offline」 */
const FIREBASE_COOLING_MS = 500;
/** 離線時重試取得 isPremium 的延遲（ms） */
const IS_PREMIUM_RETRY_DELAY_MS = 1000;
const IS_PREMIUM_RETRY_MAX = 2;

async function fetchIsPremium(uid) {
  if (!db) return false;
  const snap = await getDoc(doc(db, "profiles", uid));
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
  if (code === "auth/popup-closed-by-user") {
    return i18n.t("common:authError_popupClosed");
  }
  if (code === "auth/popup-blocked") {
    return i18n.t("common:authError_popupBlocked");
  }
  if (code === "auth/requires-recent-login") {
    return i18n.t("common:authError_requiresRecentLogin");
  }
  return err?.message ?? i18n.t("common:authError_loginFailed");
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  /** 訪客狀態：true 表示以「不留名參觀」進入，可瀏覽 /vote 但不可投票 */
  const [isGuest, setIsGuest] = useState(false);
  /** profiles/{uid} 文件：實時監聽，資料庫一出現即更新，供戰區無縫顯示投票 UI [cite: 2026-02-11] */
  const [profile, setProfile] = useState(null);
  /** 在已登入但尚未收到第一筆 profile snapshot 前為 true，避免戰區誤判為「未登錄」 */
  const [profileLoading, setProfileLoading] = useState(false);
  const retryTimeoutRef = useRef(null);
  const coolingTimeoutRef = useRef(null);
  const profileUnsubscribeRef = useRef(null);

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
        setLoading(false);
        return;
      }
      // 先寫入 user，避免彈窗關閉後 UI 仍等 Firestore
      const nextUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        isPremium: false,
      };
      setCurrentUser(nextUser);
      setIsGuest(false);
      setLoading(false);
      setProfile(null);
      setProfileLoading(true);

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

  // 使用彈窗登入；Vite 已設 COOP: same-origin-allow-popups 避免「window.closed」被擋。
  // 若彈窗仍被 COOP 阻擋，可改為 signInWithRedirect + getRedirectResult（需處理 init.json 或部署 Hosting）。
  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseReady || !auth || !googleProvider) {
      setAuthError(i18n.t("common:authError_firebaseNotReady"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] Firebase 未就緒，無法執行登入");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setAuthError(message);
      if (import.meta.env.DEV)
        console.warn(
          "[AuthContext] signInWithPopup 失敗:",
          err?.code ?? err?.message,
        );
      throw err;
    }
  }, []);

  /** 以訪客身份進入：僅設 isGuest 為 true，導向由呼叫端（如 LoginPage）負責 */
  const continueAsGuest = useCallback(() => {
    setAuthError(null);
    setIsGuest(true);
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    setIsGuest(false);
    setProfile(null);
    setProfileLoading(false);
    if (!auth) {
      setCurrentUser(null);
      return;
    }
    try {
      await firebaseSignOut(auth);
      setCurrentUser(null);
    } catch (err) {
      setAuthError(err?.message ?? i18n.t("common:signOutFailed"));
      if (import.meta.env.DEV)
        console.warn("[AuthContext] signOut 失敗:", err?.message);
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
          await reauthenticateWithPopup(auth.currentUser, googleProvider);
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

  /** 重新投票：清除當前立場與投票；若 resetProfile 為 true，一併清除年齡／性別／球隊／國家／城市並設 hasProfile 為 false */
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
        await revokeVote(uid, resetProfile);
      } catch (err) {
        const msg = err?.message ?? i18n.t("common:revoteError");
        setAuthError(msg);
        if (import.meta.env.DEV) {
          console.warn("[AuthContext] revote 失敗:", err?.message);
        }
        throw err;
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
