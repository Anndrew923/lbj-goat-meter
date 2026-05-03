/**
 * useProfileSetupGate — 戰區登錄 Modal 狀態機
 *
 * 設計意圖：
 *   1. 單一出口：dismissProfileSetup 是唯一的關閉路徑（close + saved 走同一條），
 *      防止 handleClose vs onSaved 的狀態漂移在 WebView 點擊穿透時造成雙重觸發。
 *   2. 手動掛載鎖（isSetupMounted）：一旦 shouldShowSetup 變 true 就掛上，
 *      卸載只能由 dismissProfileSetup 觸發，不隨 Auth 抖動自動卸載，避免 APK 閃爍。
 *   3. profileLoadingSettled 鎖定：profile loading 首次完成即鎖定，
 *      後續任何 loading 抖動（如 token 刷新）都不影響 Modal 顯示判斷。
 *   4. UID 防抖：真換帳號時重置所有 gate 狀態；同 UID 的噪音重入（APK WebView rehydrate）一律忽略。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * @param {object} params
 * @param {string|null|undefined} params.uid - currentUser?.uid
 * @param {boolean} params.isGuest
 * @param {boolean} params.profileLoading
 * @param {boolean} params.hasProfile
 * @param {boolean} params.isProtocolOpen
 * @param {boolean} params.isGuestBootstrapLoading
 */
export function useProfileSetupGate({
  uid,
  isGuest,
  profileLoading,
  hasProfile,
  isProtocolOpen,
  isGuestBootstrapLoading,
}) {
  const [profileSetupDismissed, setProfileSetupDismissed] = useState(false);
  const [profileLoadingSettled, setProfileLoadingSettled] = useState(false);
  const [hasHandledDismissal, setHasHandledDismissal] = useState(false);
  const [isSetupMounted, setIsSetupMounted] = useState(false);
  const [showWarzoneClaimModal, setShowWarzoneClaimModal] = useState(false);
  const lastStableUidRef = useRef(uid);

  // 帳號定錨：只在「新有效 UID」出現時重置，忽略 null/undefined（APK rehydrate 噪音）
  useEffect(() => {
    if (uid && uid !== lastStableUidRef.current) {
      setProfileSetupDismissed(false);
      setProfileLoadingSettled(false);
      setHasHandledDismissal(false);
      setIsSetupMounted(false);
      lastStableUidRef.current = uid;
    }
  }, [uid]);

  // profileLoading 首次完成即鎖定，後續抖動不影響
  useEffect(() => {
    if (!uid || profileLoading) return;
    setProfileLoadingSettled(true);
  }, [uid, profileLoading]);

  const shouldShowSetup = useMemo(() => {
    if (isProtocolOpen) return false;
    // 手動強制開啟（最高優先級，例如用戶點擊「切換戰區」）
    if (showWarzoneClaimModal) return true;
    // 已關閉或仍在 Guest 冷啟動中：不彈窗
    if (hasHandledDismissal || isGuestBootstrapLoading) return false;
    // Profile 同步中：不彈窗，避免「資料尚未抵達」的瞬間誤判
    if (profileLoading) return false;
    // 自動觸發：已登入、載入穩定、無 profile、且未手動關閉
    return (
      Boolean(uid) &&
      !isGuest &&
      profileLoadingSettled &&
      !hasProfile &&
      !profileSetupDismissed
    );
  }, [
    isProtocolOpen,
    showWarzoneClaimModal,
    hasHandledDismissal,
    isGuestBootstrapLoading,
    profileLoading,
    uid,
    isGuest,
    profileLoadingSettled,
    hasProfile,
    profileSetupDismissed,
  ]);

  // shouldShowSetup 變為 true → 掛上 Modal（卸載只走 dismissProfileSetup）
  useEffect(() => {
    if (shouldShowSetup) setIsSetupMounted(true);
  }, [shouldShowSetup]);

  /** 統一關閉路徑：close / saved / backdrop 全部走這裡 */
  const dismissProfileSetup = useCallback((e) => {
    if (e?.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsSetupMounted(false);
    setHasHandledDismissal(true);
    setProfileSetupDismissed(true);
    setShowWarzoneClaimModal(false);
  }, []);

  /** 重置後重新開啟（revote 完成且 resetProfileChecked 時使用） */
  const reopenAfterRevote = useCallback(() => {
    setProfileSetupDismissed(false);
    setShowWarzoneClaimModal(true);
  }, []);

  return {
    isSetupMounted,
    shouldShowSetup,
    showWarzoneClaimModal,
    dismissProfileSetup,
    openWarzoneClaimModal: () => setShowWarzoneClaimModal(true),
    reopenAfterRevote,
  };
}
