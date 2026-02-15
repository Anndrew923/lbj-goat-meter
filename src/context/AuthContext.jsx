/**
 * AuthContext — 全域認證與權限狀態
 *
 * 設計意圖：為何將認證邏輯與金流權限（Entitlement）放在 Context 層？
 * 1. 單一真相來源：登入狀態與 isPremium 由一處維護，避免各頁面重複呼叫 Firebase Auth / 金流 API。
 * 2. 保護路由與 UI 一致：需登入或需 Premium 的頁面可直接依 currentUser / isPremium 決定導向或遮罩。
 * 3. 為後續「通用金流模組」預留接口：金流模組僅需在登入後寫入/更新 Context 的 isPremium，
 *    業務組件只消費 Context，不直接依賴金流實作，符合解耦與可測試性。
 *
 * 潛在影響：Context 變動會觸發所有訂閱組件 re-render，若未來用戶對象欄位增多，
 *          可考慮將 isPremium 拆成獨立 EntitlementContext 或 useEntitlement() 以縮小影響範圍。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, googleProvider, db } from '../lib/firebase'

const AuthContext = createContext(null)

async function fetchIsPremium(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid))
  return snap.exists() && snap.data()?.isPremium === true
}

/** 將 Firebase Auth 錯誤碼轉成使用者可讀訊息，利於除錯與 UX */
function getAuthErrorMessage(err) {
  const code = err?.code ?? ''
  if (code === 'auth/configuration-not-found' || err?.message?.includes('CONFIGURATION_NOT_FOUND')) {
    return 'Firebase 認證尚未設定完成，請到 Firebase 主控台啟用 Authentication（Google 登入）並確認 .env 與專案一致。'
  }
  if (code === 'auth/popup-closed-by-user') {
    return '登入視窗已關閉。請再試一次；若仍失敗，請改用「重新導向登入」或檢查瀏覽器是否封鎖彈出視窗。'
  }
  if (code === 'auth/popup-blocked') {
    return '登入視窗被瀏覽器封鎖，請允許彈出視窗或使用重新導向登入。'
  }
  return err?.message ?? 'Google 登入失敗'
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)
  /** 訪客狀態：true 表示以「不留名參觀」進入，可瀏覽 /vote 但不可投票 */
  const [isGuest, setIsGuest] = useState(false)

  const refreshEntitlements = useCallback(async () => {
    if (!currentUser?.uid) return
    const isPremium = await fetchIsPremium(currentUser.uid)
    setCurrentUser((prev) => (prev ? { ...prev, isPremium } : null))
  }, [currentUser?.uid])

  // 從 Google 重新導向回來時處理登入結果（避免 COOP 阻擋彈窗導致的錯誤）
  useEffect(() => {
    let cancelled = false
    getRedirectResult(auth)
      .then((result) => {
        if (cancelled) return
        if (result?.user) setAuthError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setAuthError(getAuthErrorMessage(err))
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isPremium = await fetchIsPremium(user.uid)
        setCurrentUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          isPremium,
        })
        setIsGuest(false) // Google 登入成功後清除訪客狀態
      } else {
        setCurrentUser(null)
      }
      setAuthError(null)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  // 使用重新導向登入，避免彈窗被 COOP / 廣告攔截器阻擋導致 auth/popup-closed-by-user
  const loginWithGoogle = useCallback(async () => {
    setAuthError(null)
    try {
      await signInWithRedirect(auth, googleProvider)
      // 頁面會導向 Google，不會執行到這裡；回來後由 getRedirectResult 處理
    } catch (err) {
      setAuthError(getAuthErrorMessage(err))
      throw err
    }
  }, [])

  /** 以訪客身份進入：僅設 isGuest 為 true，導向由呼叫端（如 LoginPage）負責 */
  const continueAsGuest = useCallback(() => {
    setAuthError(null)
    setIsGuest(true)
  }, [])

  const signOut = useCallback(async () => {
    setAuthError(null)
    setIsGuest(false)
    try {
      await firebaseSignOut(auth)
      setCurrentUser(null)
    } catch (err) {
      setAuthError(err?.message ?? '登出失敗')
    }
  }, [])

  const clearAuthError = useCallback(() => setAuthError(null), [])

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      authError,
      isGuest,
      loginWithGoogle,
      continueAsGuest,
      signOut,
      clearAuthError,
      refreshEntitlements,
    }),
    [
      currentUser,
      loading,
      authError,
      isGuest,
      loginWithGoogle,
      continueAsGuest,
      signOut,
      clearAuthError,
      refreshEntitlements,
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx == null) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
