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
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, googleProvider, db } from '../lib/firebase'

const AuthContext = createContext(null)

async function fetchIsPremium(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid))
  return snap.exists() && snap.data()?.isPremium === true
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  const refreshEntitlements = useCallback(async () => {
    if (!currentUser?.uid) return
    const isPremium = await fetchIsPremium(currentUser.uid)
    setCurrentUser((prev) => (prev ? { ...prev, isPremium } : null))
  }, [currentUser?.uid])

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
      } else {
        setCurrentUser(null)
      }
      setAuthError(null)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      setAuthError(err?.message ?? 'Google 登入失敗')
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    setAuthError(null)
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
      loginWithGoogle,
      signOut,
      clearAuthError,
      refreshEntitlements,
    }),
    [currentUser, loading, authError, loginWithGoogle, signOut, clearAuthError, refreshEntitlements]
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
