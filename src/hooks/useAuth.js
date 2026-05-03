/**
 * useAuth — 向後相容複合 Hook
 *
 * 設計意圖：
 *   作為 AuthContext / ProfileContext / EntitlementContext 三層的統一聚合接口。
 *   回傳值與舊版 useAuth() 完全一致，現有所有消費者零修改。
 *
 * 性能考量：
 *   此 Hook 會在三個 Context 中任一狀態變化時觸發 re-render，
 *   對渲染性能敏感的新組件應直接使用 useAuthContext() / useProfile() / useEntitlement()
 *   以獲得更窄的訂閱範圍。
 *
 * 錯誤合併策略：
 *   auth error 優先顯示（登入/登出/刪帳），entitlement error 在無 auth error 時顯示（revote）。
 *   clearAuthError 同時清空兩個錯誤通道，符合 VotePage 的 UI 語意。
 */
import { useMemo, useCallback } from "react";
import { useAuthContext } from "../context/AuthContext";
import { useProfile } from "../context/ProfileContext";
import { useEntitlement } from "../context/EntitlementContext";

export function useAuth() {
  const authCtx = useAuthContext();
  const profileCtx = useProfile();
  const entitlementCtx = useEntitlement();

  const clearAuthError = useCallback(() => {
    authCtx.clearAuthError();
    entitlementCtx.clearEntitlementError();
  }, [authCtx, entitlementCtx]);

  return useMemo(
    () => ({
      // 身分層（AuthContext）
      currentUser: authCtx.currentUser,
      loading: authCtx.loading,
      isGuest: authCtx.isGuest,
      // 錯誤通道合併（auth error 優先）
      authError: authCtx.authError || entitlementCtx.entitlementError || null,
      clearAuthError,
      // 資料層（ProfileContext）
      profile: profileCtx.profile,
      profileLoading: profileCtx.profileLoading,
      hasProfile: profileCtx.hasProfile,
      // 登入方法（AuthContext）
      loginWithGoogle: authCtx.loginWithGoogle,
      loginWithApple: authCtx.loginWithApple,
      continueAsGuest: authCtx.continueAsGuest,
      signOut: authCtx.signOut,
      deleteAccount: authCtx.deleteAccount,
      // 權限方法（EntitlementContext）
      refreshEntitlements: entitlementCtx.refreshEntitlements,
      revote: entitlementCtx.revote,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authCtx, profileCtx, entitlementCtx, clearAuthError],
  );
}
