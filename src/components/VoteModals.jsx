/**
 * VoteModals — VotePage 三層設定彈窗
 *
 * 設計意圖：
 *   將 VotePage 原本內聯的 280 行彈窗 JSX 提取至獨立元件，讓 VotePage 聚焦在骨架與路由。
 *   此元件只負責呈現（presentational component），所有狀態與 handler 由 useSettingsModals Hook
 *   管理後以 props 傳入，符合「狀態下沉、展示上提」的 React 慣例。
 *
 * 彈窗層次：
 *   Settings (z-60)  →  DeleteConfirm (z-70)  /  ResetStanceConfirm (z-70)
 */
import { AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import ModalShell from "./ModalShell";
import LanguageToggle from "./LanguageToggle";

/**
 * @param {object} props
 * @param {ReturnType<import('../hooks/votePage/useSettingsModals').useSettingsModals>} props.settings
 * @param {Record<string,unknown>|null} props.profile
 * @param {string|null} props.authError
 * @param {() => void} props.clearAuthError
 * @param {() => void} props.replayProtocol
 * @param {(key: string) => string} props.t
 * @param {boolean} props.isGuest
 */
export default function VoteModals({
  settings,
  profile,
  authError,
  clearAuthError,
  replayProtocol,
  t,
  isGuest,
}) {
  const {
    settingsOpen,
    closeSettings,
    openDeleteConfirm,
    openResetStanceConfirm,
    deleteConfirmOpen,
    closeDeleteConfirm,
    deleting,
    handleDeleteAccount,
    resetStanceConfirmOpen,
    closeResetStanceConfirm,
    resetProfileChecked,
    setResetProfileChecked,
    resetStanceSubmitting,
    handleRevoteConfirm,
  } = settings;

  return (
    <>
      {/* ── Settings Panel ── */}
      <AnimatePresence initial={false}>
        {settingsOpen && !isGuest && (
          <ModalShell
            key="vote-settings-modal"
            rootClassName="fixed inset-0 z-[60] overflow-y-auto"
            backdropClassName="bg-black/90"
            panelClassName="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-villain-purple/30 bg-gray-900 pt-6 px-6"
            panelMotionProps={{
              initial: { y: 40, opacity: 0 },
              animate: { y: 0, opacity: 1 },
              exit: { y: 40, opacity: 0 },
              transition: { type: "spring", damping: 28, stiffness: 300 },
              onClick: (e) => e.stopPropagation(),
            }}
            onBackdropClick={closeSettings}
            rootMotionProps={{
              role: "dialog",
              "aria-modal": true,
              "aria-labelledby": "settings-title",
            }}
          >
            <div className="flex justify-between items-center mb-6 flex-shrink-0">
              <h2 id="settings-title" className="text-lg font-bold text-king-gold">
                {t("settings")}
              </h2>
              <button type="button" onClick={closeSettings} className="text-gray-400 hover:text-white">
                {t("close")}
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar settings-modal-content-inset">
              {authError && (
                <p className="mb-4 text-sm text-red-400" role="alert">{authError}</p>
              )}
              <section className="pb-6 border-b border-villain-purple/20">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                  {t("preferences")}
                </p>
                {profile?.hasVoted === true && (
                  <button
                    type="button"
                    onClick={openResetStanceConfirm}
                    className="w-full mb-4 py-3 rounded-xl font-medium text-gray-300 bg-gray-800 border border-villain-purple/40 hover:border-king-gold/50 hover:text-king-gold"
                  >
                    {t("resetStance")}
                  </button>
                )}
                <Link
                  to="/privacy"
                  onClick={closeSettings}
                  className="block w-full mb-4 py-3 rounded-xl font-medium text-gray-300 bg-gray-800 border border-villain-purple/40 hover:border-king-gold/50 hover:text-king-gold text-center"
                >
                  {t("privacyPolicy")}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    closeSettings();
                    replayProtocol();
                  }}
                  className="w-full mb-4 py-3 rounded-xl font-medium text-gray-300 bg-gray-800 border border-villain-purple/40 hover:border-king-gold/50 hover:text-king-gold"
                >
                  {t("protocolReplay")}
                </button>
                <LanguageToggle />
              </section>
              <section className="mt-8 pt-8 border-t border-red-900/50">
                <p className="text-xs uppercase tracking-wider text-red-400/90 font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" aria-hidden />
                  {t("dangerZone")}
                </p>
                <p className="text-sm text-gray-500 mb-4">{t("dangerZoneDesc")}</p>
                <button
                  type="button"
                  onClick={openDeleteConfirm}
                  className="w-full py-3 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 border border-red-500/50"
                >
                  {t("deleteAccount")}
                </button>
              </section>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm ── */}
      <AnimatePresence initial={false}>
        {deleteConfirmOpen && (
          <ModalShell
            key="vote-delete-confirm"
            rootClassName="fixed inset-0 z-[70] overflow-y-auto"
            backdropClassName="bg-black/80"
            panelClassName="w-full max-w-sm rounded-2xl border border-red-900/60 bg-gray-900 p-6 shadow-xl"
            panelMotionProps={{
              initial: { opacity: 0, scale: 0.95 },
              animate: { opacity: 1, scale: 1 },
              exit: { opacity: 0, scale: 0.95 },
              onClick: (e) => e.stopPropagation(),
            }}
            onBackdropClick={() => { if (!deleting) closeDeleteConfirm(); }}
            rootMotionProps={{
              role: "alertdialog",
              "aria-modal": true,
              "aria-labelledby": "delete-confirm-title",
            }}
          >
            <h3 id="delete-confirm-title" className="text-lg font-bold text-red-400 mb-2">
              {t("deleteConfirmTitle")}
            </h3>
            <p className="text-sm text-gray-400 mb-4">{t("deleteConfirmDesc")}</p>
            {authError && (
              <div className="mb-4 flex flex-col gap-2">
                <p className="text-sm text-red-400" role="alert">{authError}</p>
                <button
                  type="button"
                  onClick={clearAuthError}
                  className="self-start py-2 px-3 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/50 hover:bg-red-500/30"
                >
                  {t("retry")}
                </button>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? t("deleting") : t("deletePermanently")}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Reset Stance Confirm ── */}
      <AnimatePresence initial={false}>
        {resetStanceConfirmOpen && (
          <ModalShell
            key="vote-reset-stance-confirm"
            rootClassName="fixed inset-0 z-[70] overflow-y-auto"
            backdropClassName="bg-black/80"
            panelClassName="w-full max-w-sm rounded-2xl border border-villain-purple/40 bg-gray-900 p-6 shadow-xl"
            panelMotionProps={{
              initial: { opacity: 0, scale: 0.95 },
              animate: { opacity: 1, scale: 1 },
              exit: { opacity: 0, scale: 0.95 },
              onClick: (e) => e.stopPropagation(),
            }}
            onBackdropClick={() => { if (!resetStanceSubmitting) closeResetStanceConfirm(); }}
            rootMotionProps={{
              role: "alertdialog",
              "aria-modal": true,
              "aria-labelledby": "reset-stance-confirm-title",
              "aria-describedby": "reset-stance-confirm-desc",
            }}
          >
            <h3 id="reset-stance-confirm-title" className="text-lg font-bold text-king-gold mb-2">
              {t("resetStanceConfirmTitle")}
            </h3>
            <p id="reset-stance-confirm-desc" className="text-sm text-gray-400 mb-4">
              {t("resetStanceConfirmDesc")}
            </p>
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={resetProfileChecked}
                onChange={(e) => setResetProfileChecked(e.target.checked)}
                className="mt-1 rounded border-gray-500 text-king-gold focus:ring-king-gold/50"
                aria-describedby="reset-profile-option-label"
              />
              <span id="reset-profile-option-label" className="text-sm text-gray-300">
                {t("resetProfileOption")}
              </span>
            </label>
            {authError && (
              <p className="text-sm text-red-400 mb-4" role="alert">{authError}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeResetStanceConfirm}
                disabled={resetStanceSubmitting}
                className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-60"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleRevoteConfirm}
                disabled={resetStanceSubmitting}
                className="flex-1 py-3 rounded-xl font-bold text-white bg-king-gold text-black hover:bg-king-gold/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resetStanceSubmitting ? t("resettingStance") : t("resetStance")}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-white/35">
              ⚡ {t("ad_support_msg")}
            </p>
          </ModalShell>
        )}
      </AnimatePresence>
    </>
  );
}
