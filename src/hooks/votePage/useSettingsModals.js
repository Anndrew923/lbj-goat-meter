/**
 * useSettingsModals — 設定面板三層狀態機
 *
 * 設計意圖（Strava 帳號設定模式）：
 *   1. 三個 Modal 的開/關/提交狀態集中管理，消除 VotePage 層的 6 個 useState。
 *   2. 非同步操作（deleteAccount / revote）的 loading 狀態與錯誤後清理全封裝在此，
 *      消費端（VotePage / VoteModals）只需呼叫 handler，不感知內部流程。
 *   3. revote 成功後呼叫 onRevoteSuccess(resetProfileChecked)，
 *      由 VotePage 決定是否重開 WarzoneClaimModal，Hook 本身不直接耦合 ProfileSetupGate。
 *
 * 錯誤通道：revote / deleteAccount 的錯誤已由 EntitlementContext / AuthContext 寫入
 *   authError，此 Hook 不需自行維護 error state，僅負責 submitting 旗標。
 */
import { useCallback, useState } from "react";

/**
 * @param {object} params
 * @param {() => Promise<void>} params.deleteAccount
 * @param {(resetProfile: boolean) => Promise<void>} params.revote
 * @param {() => void} params.clearAuthError
 * @param {(resetProfileChecked: boolean) => void} params.onRevoteSuccess
 */
export function useSettingsModals({
  deleteAccount,
  revote,
  clearAuthError,
  onRevoteSuccess,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetStanceConfirmOpen, setResetStanceConfirmOpen] = useState(false);
  const [resetProfileChecked, setResetProfileChecked] = useState(false);
  const [resetStanceSubmitting, setResetStanceSubmitting] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    clearAuthError();
  }, [clearAuthError]);

  const openDeleteConfirm = useCallback(() => {
    setSettingsOpen(false);
    setDeleteConfirmOpen(true);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirmOpen(false);
    clearAuthError();
  }, [clearAuthError]);

  /** 帳號刪除：errors 已寫入 authError，保留彈窗讓用戶閱讀後自行關閉 */
  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    clearAuthError();
    try {
      await deleteAccount();
    } catch {
      // 錯誤已由 AuthContext 寫入 authError
    } finally {
      setDeleting(false);
    }
  }, [deleteAccount, clearAuthError]);

  const openResetStanceConfirm = useCallback(() => {
    clearAuthError();
    setResetStanceConfirmOpen(true);
    setResetProfileChecked(false);
  }, [clearAuthError]);

  const closeResetStanceConfirm = useCallback(() => {
    setResetStanceConfirmOpen(false);
    clearAuthError();
  }, [clearAuthError]);

  /** revote：成功後關閉彈窗鏈，並通知外部決定是否重開 WarzoneClaimModal */
  const handleRevoteConfirm = useCallback(async () => {
    setResetStanceSubmitting(true);
    clearAuthError();
    try {
      await revote(resetProfileChecked);
      setResetStanceConfirmOpen(false);
      setSettingsOpen(false);
      onRevoteSuccess?.(resetProfileChecked);
    } catch {
      // 錯誤已寫入 authError，保留彈窗
    } finally {
      setResetStanceSubmitting(false);
    }
  }, [revote, clearAuthError, resetProfileChecked, onRevoteSuccess]);

  return {
    // Settings
    settingsOpen,
    openSettings,
    closeSettings,
    // Delete confirm
    deleteConfirmOpen,
    openDeleteConfirm,
    closeDeleteConfirm,
    deleting,
    handleDeleteAccount,
    // Reset stance confirm
    resetStanceConfirmOpen,
    openResetStanceConfirm,
    closeResetStanceConfirm,
    resetProfileChecked,
    setResetProfileChecked,
    resetStanceSubmitting,
    handleRevoteConfirm,
  };
}
