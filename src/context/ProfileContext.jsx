/**
 * ProfileContext — Firestore 用戶資料訂閱層
 *
 * 設計意圖（Spotify 資料層分離原則）：
 *   1. 單一職責：只管「你的資料是什麼」— profile 文件、hasProfile 推導、profileLoading 狀態。
 *   2. 響應式訂閱：依賴 AuthContext 的 currentUser.uid，uid 變化時自動切換訂閱目標。
 *   3. 冷卻防抖：auth 穩定後延遲 500ms 再打 Firestore，防止 APK/WebView「client is offline」瞬間錯誤。
 *   4. 離線重試：onSnapshot 可能因網路延遲而延遲，保留 fetchIsPremium 重試邏輯作為保底。
 *
 * 生命週期：
 *   - uid 出現（登入）→ 啟動冷卻計時器 → 啟動 onSnapshot
 *   - uid 消失（登出/刪帳）→ 取消訂閱，清空 profile
 *   - 同 UID 重入（token 刷新）→ useEffect deps 未變，不重複訂閱
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
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuthContext } from "./AuthContext";

export const ProfileContext = createContext(null);

/** 連線冷卻期：auth 穩定後延遲再打 Firestore，避免「client is offline」 */
const FIREBASE_COOLING_MS = 500;
/** 離線時重試取得 isPremium 的延遲 */
const IS_PREMIUM_RETRY_DELAY_MS = 1000;
const IS_PREMIUM_RETRY_MAX = 2;

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

export function ProfileProvider({ children }) {
  const { currentUser, setCurrentUser } = useAuthContext();
  const uid = currentUser?.uid ?? null;

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const coolingTimeoutRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const profileUnsubscribeRef = useRef(null);

  const cancelSubscription = useCallback(() => {
    if (coolingTimeoutRef.current) {
      clearTimeout(coolingTimeoutRef.current);
      coolingTimeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (profileUnsubscribeRef.current) {
      profileUnsubscribeRef.current();
      profileUnsubscribeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!uid) {
      cancelSubscription();
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    if (!db) {
      setProfileLoading(false);
      return;
    }

    // 新 uid 進入：重置狀態，啟動冷卻後訂閱
    setProfile(null);
    setProfileLoading(true);
    cancelSubscription();

    coolingTimeoutRef.current = setTimeout(() => {
      coolingTimeoutRef.current = null;

      const profileRef = doc(db, "profiles", uid);
      profileUnsubscribeRef.current = onSnapshot(
        profileRef,
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          setProfile(data);
          setProfileLoading(false);
          // 同步 isPremium 回 AuthContext 的 currentUser（向後相容欄位）
          setCurrentUser((prev) => {
            if (prev?.uid !== uid) return prev;
            return { ...prev, isPremium: data?.isPremium === true };
          });
        },
        (err) => {
          if (import.meta.env.DEV) {
            console.warn(
              "[ProfileContext] profile onSnapshot 錯誤:",
              err?.message ?? err,
            );
          }
          setProfileLoading(false);
        },
      );

      // 保底重試：離線時 onSnapshot 可能延遲，先用 getDoc 快速補齊 isPremium
      const tryFetchPremium = (retryCount = 0) => {
        fetchIsPremium(uid)
          .then((isPremium) => {
            setCurrentUser((prev) =>
              prev?.uid === uid ? { ...prev, isPremium } : prev,
            );
          })
          .catch((err) => {
            if (import.meta.env.DEV) {
              console.warn(
                "[ProfileContext] 取得 isPremium 失敗:",
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

    return () => cancelSubscription();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  /** 有完成戰區登錄：profile 存在且未標記為需重設 */
  const hasProfile = Boolean(profile && profile.hasProfile !== false);

  const value = useMemo(
    () => ({ profile, profileLoading, hasProfile }),
    [profile, profileLoading, hasProfile],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (ctx == null)
    throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
