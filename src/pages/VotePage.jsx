import { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import UserProfileSetup from "../components/UserProfileSetup";
import VotingArena from "../components/VotingArena";
import AnalystGate from "../components/AnalystGate";
import SentimentStats from "../components/SentimentStats";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import { useAnalystAuth } from "../hooks/useAnalystAuth";
import FilterFunnel from "../components/FilterFunnel";
import ReconPermissionIndicator from "../components/ReconPermissionIndicator";
import LiveTicker from "../components/LiveTicker";
import PulseMap from "../components/PulseMap";
import LanguageToggle from "../components/LanguageToggle";
import { triggerHaptic } from "../utils/hapticUtils";
import { motion, AnimatePresence } from "framer-motion";
import {
  SlidersHorizontal,
  Settings,
  AlertTriangle,
  LogOut,
} from "lucide-react";

export default function VotePage() {
  const { t, i18n } = useTranslation("common");
  const isEn = i18n.language === "en";
  const {
    currentUser,
    isGuest,
    signOut,
    deleteAccount,
    hasProfile,
    profile,
    profileLoading,
    authError,
    clearAuthError,
    revote,
  } = useAuth();
  const navigate = useNavigate();
  const [profileSetupDismissed, setProfileSetupDismissed] = useState(false);
  const [filters, setFilters] = useState({});
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetStanceConfirmOpen, setResetStanceConfirmOpen] = useState(false);
  const [resetProfileChecked, setResetProfileChecked] = useState(false);
  const [resetStanceSubmitting, setResetStanceSubmitting] = useState(false);
  const [showWarzoneClaimModal, setShowWarzoneClaimModal] = useState(false);
  const stableFilters = useMemo(() => ({ ...filters }), [filters]);
  const { isAnalystAuthorized, onRequestRewardAd, analystAdPortal } =
    useAnalystAuth();

  // 換帳號或重新登入時重置「已關閉」狀態，讓新使用者有機會看到戰區登錄 Modal
  useEffect(() => {
    setProfileSetupDismissed(false);
  }, [currentUser?.uid]);

  // 依 Context 實時 hasProfile：已登入且 profile 已載入完畢仍無文件時，顯示戰區登錄 Modal
  const needProfileSetup =
    Boolean(currentUser?.uid) && !profileLoading && !hasProfile;
  const showProfileSetup =
    (needProfileSetup && !profileSetupDismissed) || showWarzoneClaimModal;

  return (
    <div className="min-h-screen bg-black text-white pt-6 px-6 safe-area-inset-bottom">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed top-0 left-0 w-full z-50 flex items-center justify-between bg-black/80 backdrop-blur-xl border-b border-b-[0.5px] border-white/5 pb-4 safe-area-inset-top px-6"
      >
        <h1 className="flex flex-row items-baseline">
          <span className="text-sm tracking-widest text-king-gold/80">
            {t("voteBattlefieldPart1")}
          </span>
          <span
            className={`text-xl font-black tracking-tighter text-king-gold ml-1.5 ${isEn ? "uppercase" : ""}`}
          >
            {t("voteBattlefieldPart2")}
          </span>
        </h1>
        <div className="flex items-center gap-x-4">
          <span className="text-sm text-gray-400">
            {isGuest
              ? t("guest")
              : (currentUser?.displayName ?? currentUser?.email)}
          </span>
          {isGuest ? (
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-sm text-king-gold hover:underline"
            >
              {t("signIn")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className={
                  isEn
                    ? "p-2 text-gray-400 hover:text-king-gold rounded-lg"
                    : "flex items-center gap-1.5 text-sm text-gray-400 hover:text-king-gold"
                }
                aria-label={t("openSettings")}
              >
                <Settings className="w-4 h-4" />
                {!isEn && t("settings")}
              </button>
              <button
                type="button"
                onClick={signOut}
                className={
                  isEn
                    ? "p-2 text-villain-purple hover:text-villain-purple/80 rounded-lg"
                    : "text-sm text-villain-purple hover:underline"
                }
                aria-label={t("signOut")}
              >
                {isEn ? <LogOut className="w-4 h-4" /> : t("signOut")}
              </button>
            </>
          )}
        </div>
      </motion.header>
      {/* 與固定 Header 等高的 Spacer，避免首屏內容被遮擋 */}
      <div className="header-spacer" aria-hidden />
      <LiveTicker />
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-8 space-y-8"
      >
        <VotingArena
          userId={currentUser?.uid}
          currentUser={currentUser}
          onOpenWarzoneSelect={() => setShowWarzoneClaimModal(true)}
        />
        <section className="relative">
          {analystAdPortal}
          {/* 大盤全面釋放：SentimentStats 不在任何 AnalystGate 內，登入/訪客皆可直接看到 */}
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-king-gold">
              {t("globalStats")}
            </h2>
          </div>
          <SentimentStats filters={stableFilters} />
          {/* 以下僅此一層 AnalystGate：僅鎖定篩選器、地圖、詳細分析 */}
          <AnalystGate
            authorized={isAnalystAuthorized}
            onRequestRewardAd={onRequestRewardAd}
            gateTitle={t("intelGateTitle")}
            gateDescription={t("intelGateDesc")}
            gateButtonText={t("intelGateButton")}
          >
            <div className="flex items-center justify-between gap-4 mb-3 mt-8">
              <ReconPermissionIndicator authorized={isAnalystAuthorized} />
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setFilterDrawerOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-villain-purple/40 text-sm text-gray-300 hover:text-king-gold hover:border-king-gold/50"
                aria-label={t("openFilter")}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {t("filter")}
              </button>
            </div>
            <FilterFunnel
              open={filterDrawerOpen}
              onClose={() => setFilterDrawerOpen(false)}
              filters={stableFilters}
              onFiltersChange={setFilters}
              authorized={isAnalystAuthorized}
            />
            <div className="mb-6">
              <PulseMap filters={stableFilters} onFiltersChange={setFilters} />
            </div>
            <div className="mt-6">
              <AnalyticsDashboard
                filters={stableFilters}
                authorized={isAnalystAuthorized}
              />
            </div>
          </AnalystGate>
        </section>
      </motion.main>

      {currentUser?.uid && (
        <UserProfileSetup
          open={showProfileSetup}
          onClose={() => {
            setProfileSetupDismissed(true);
            setShowWarzoneClaimModal(false);
          }}
          onSaved={() => {
            setProfileSetupDismissed(true);
            setShowWarzoneClaimModal(false);
          }}
          userId={currentUser?.uid}
          initialStep={1}
          initialProfile={showWarzoneClaimModal ? profile : undefined}
        />
      )}

      {/* 使用者設定區：底部為 Danger Zone（帳號刪除），符合 Google Play 合規與資料隱私透明度 */}
      <AnimatePresence>
        {settingsOpen && !isGuest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setSettingsOpen(false);
              clearAuthError();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-t-2xl border-t border-villain-purple/30 bg-gray-900 pt-6 px-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <h2
                  id="settings-title"
                  className="text-lg font-bold text-king-gold"
                >
                  {t("settings")}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    clearAuthError();
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  {t("close")}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar settings-modal-content-inset">
                {authError && (
                  <p className="mb-4 text-sm text-red-400" role="alert">
                    {authError}
                  </p>
                )}
                {/* Preferences：重置立場（僅已投票時顯示）、語系等，置於 Danger Zone 上方 */}
                <section className="pb-6 border-b border-villain-purple/20">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                    {t("preferences")}
                  </p>
                  {profile?.hasVoted === true && (
                    <button
                      type="button"
                      onClick={() => {
                        clearAuthError();
                        setResetStanceConfirmOpen(true);
                        setResetProfileChecked(false);
                      }}
                      className="w-full mb-4 py-3 rounded-xl font-medium text-gray-300 bg-gray-800 border border-villain-purple/40 hover:border-king-gold/50 hover:text-king-gold"
                    >
                      {t("resetStance")}
                    </button>
                  )}
                  <Link
                    to="/privacy"
                    onClick={() => setSettingsOpen(false)}
                    className="block w-full mb-4 py-3 rounded-xl font-medium text-gray-300 bg-gray-800 border border-villain-purple/40 hover:border-king-gold/50 hover:text-king-gold text-center"
                  >
                    {t("privacyPolicy")}
                  </Link>
                  <LanguageToggle />
                </section>
                {/* Danger Zone：半透明黑底、紅色警告按鈕，二次確認後執行刪除 */}
                <section className="mt-8 pt-8 border-t border-red-900/50">
                  <p className="text-xs uppercase tracking-wider text-red-400/90 font-semibold mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" aria-hidden />
                    {t("dangerZone")}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    {t("dangerZoneDesc")}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      setDeleteConfirmOpen(true);
                    }}
                    className="w-full py-3 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 border border-red-500/50"
                  >
                    {t("deleteAccount")}
                  </button>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 二次確認彈窗：半透明黑色遮罩、明顯紅色警告按鈕 */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            onClick={() => {
              if (!deleting) {
                setDeleteConfirmOpen(false);
                clearAuthError();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl border border-red-900/60 bg-gray-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="delete-confirm-title"
                className="text-lg font-bold text-red-400 mb-2"
              >
                {t("deleteConfirmTitle")}
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                {t("deleteConfirmDesc")}
              </p>
              {authError && (
                <div className="mb-4 flex flex-col gap-2">
                  <p className="text-sm text-red-400" role="alert">
                    {authError}
                  </p>
                  <button
                    type="button"
                    onClick={() => clearAuthError()}
                    className="self-start py-2 px-3 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/50 hover:bg-red-500/30"
                  >
                    {t("retry")}
                  </button>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmOpen(false);
                    clearAuthError();
                  }}
                  className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setDeleting(true);
                    clearAuthError();
                    try {
                      await deleteAccount();
                    } catch {
                      // 錯誤已由 AuthContext 寫入 authError，保留彈窗讓用戶閱讀後自行關閉
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deleting ? t("deleting") : t("deletePermanently")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 重置立場二次確認彈窗：可勾選一併重設個人資料，成功後若 hasProfile 為 false 會自動彈出戰區登錄 */}
      <AnimatePresence>
        {resetStanceConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-stance-confirm-title"
            aria-describedby="reset-stance-confirm-desc"
            onClick={() => {
              if (!resetStanceSubmitting) {
                setResetStanceConfirmOpen(false);
                clearAuthError();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl border border-villain-purple/40 bg-gray-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="reset-stance-confirm-title"
                className="text-lg font-bold text-king-gold mb-2"
              >
                {t("resetStanceConfirmTitle")}
              </h3>
              <p
                id="reset-stance-confirm-desc"
                className="text-sm text-gray-400 mb-4"
              >
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
                <span
                  id="reset-profile-option-label"
                  className="text-sm text-gray-300"
                >
                  {t("resetProfileOption")}
                </span>
              </label>
              {authError && (
                <p className="text-sm text-red-400 mb-4" role="alert">
                  {authError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setResetStanceConfirmOpen(false);
                    clearAuthError();
                  }}
                  disabled={resetStanceSubmitting}
                  className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-60"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setResetStanceSubmitting(true);
                    clearAuthError();
                    try {
                      await revote(resetProfileChecked);
                      setResetStanceConfirmOpen(false);
                      setSettingsOpen(false);
                      if (resetProfileChecked) {
                        setProfileSetupDismissed(false);
                        setShowWarzoneClaimModal(true);
                      }
                    } catch {
                      // 錯誤已寫入 authError，保留彈窗
                    } finally {
                      setResetStanceSubmitting(false);
                    }
                  }}
                  disabled={resetStanceSubmitting}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-king-gold text-black hover:bg-king-gold/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {resetStanceSubmitting
                    ? t("resettingStance")
                    : t("resetStance")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
