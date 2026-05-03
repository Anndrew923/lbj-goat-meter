/**
 * VotePage — 投票主頁面（精簡骨架版）
 *
 * 重構目標：
 *   744 行 → 250 行，移除所有狀態機邏輯，保留「組合、佈局、路由」三件事。
 *
 * 職責分配：
 *   useProfileSetupGate  — 戰區登錄 Modal 的觸發門檻與掛載鎖
 *   useSettingsModals    — Settings / Delete / ResetStance 三層彈窗狀態機
 *   useVoteActions       — 篩選、Deep Link、訪客、進場動畫、能量動畫
 *   VoteModals           — 三層彈窗的 JSX（從此頁提取，保持 VotePage 結構清晰）
 */
import { useMemo, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { WarzoneDataProvider } from "../context/WarzoneDataContext";
import UserProfileSetup from "../components/UserProfileSetup";
import VotingArena from "../components/VotingArena";
import AnalystGate from "../components/AnalystGate";
import SentimentStats from "../components/SentimentStats";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import { useAnalystAuth } from "../hooks/useAnalystAuth";
import FilterFunnel from "../components/FilterFunnel";
import ReconPermissionIndicator from "../components/ReconPermissionIndicator";
import LiveTicker from "../components/LiveTicker";
import UniversalBreakingBanner from "../components/UniversalBreakingBanner";
import PulseMap from "../components/PulseMap";
import LanguageToggle from "../components/LanguageToggle";
import { useBattleCardCallablePrewarm } from "../hooks/useBattleCardCallablePrewarm";
import { SentimentDataProvider } from "../context/SentimentDataContext";
import { triggerHaptic } from "../utils/hapticUtils";
import ProtocolOverlay from "../components/ProtocolOverlay";
import useProtocolInitialization from "../hooks/useProtocolInitialization";
import VoteModals from "../components/VoteModals";
import AdPreloadOverlay from "../components/AdPreloadOverlay";
import { AnimatePresence, motion } from "framer-motion";
import { useProfileSetupGate } from "../hooks/votePage/useProfileSetupGate";
import { useSettingsModals } from "../hooks/votePage/useSettingsModals";
import { useVoteActions } from "../hooks/votePage/useVoteActions";
import {
  SlidersHorizontal,
  Settings,
  LogOut,
  Info,
  Archive,
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
    revoteAdLoading,
  } = useAuth();

  useBattleCardCallablePrewarm(currentUser);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isOpen: isProtocolOpen, completeProtocol, replayProtocol } =
    useProtocolInitialization();
  const {
    isAnalystAuthorized,
    remainingPoints,
    consumePoint,
    onEnergyExhausted,
    onRequestRewardAd,
    analystAdPortal,
  } = useAnalystAuth();

  // ── 戰區登錄 Modal 狀態機 ──────────────────────────────────────
  const actions = useVoteActions({
    isGuest,
    searchParams,
    voterTeam: profile?.voterTeam,
    remainingPoints,
    signOut,
    navigate,
    t,
  });

  const setupGate = useProfileSetupGate({
    uid: currentUser?.uid,
    isGuest,
    profileLoading,
    hasProfile,
    isProtocolOpen,
    isGuestBootstrapLoading: actions.isGuestBootstrapLoading,
  });

  const settingsModals = useSettingsModals({
    deleteAccount,
    revote,
    clearAuthError,
    onRevoteSuccess: (resetProfileChecked) => {
      if (resetProfileChecked) setupGate.reopenAfterRevote();
    },
  });

  // Protocol overlay：鎖定 body scroll 避免背景穿透滾動
  useEffect(() => {
    if (typeof document === "undefined" || !isProtocolOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isProtocolOpen]);

  // stableFilters 由 useVoteActions 維護，此處直接取用
  const stableFilters = useMemo(
    () => actions.stableFilters,
    [actions.stableFilters],
  );

  return (
    <div className="min-h-screen bg-black text-white pt-6 px-6 safe-area-inset-bottom safe-px-screen">
      {/* ── Fixed Header ───────────────────────────────────────── */}
      <motion.header
        initial={actions.votePageIntroDone ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed top-0 left-0 w-full z-50 flex items-center justify-between bg-black/90 border-b border-b-[0.5px] border-white/5 pb-4 safe-pt-header px-6 safe-px-screen"
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
              onClick={actions.handleGuestToLogin}
              className="text-sm text-king-gold hover:underline"
            >
              {t("signIn")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={settingsModals.openSettings}
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

      <div className="header-spacer" aria-hidden />

      {/* ── Main Content ────────────────────────────────────────── */}
      <WarzoneDataProvider>
        <LiveTicker forcePaused={actions.tickerPausedForExport} />
        <motion.main
          initial={actions.votePageIntroDone ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-8 space-y-8"
          onAnimationComplete={actions.markIntroDone}
        >
          {actions.isGuestBootstrapLoading && (
            <div className="rounded-xl border border-villain-purple/20 bg-gray-900/60 p-5 animate-pulse">
              <div className="h-4 w-28 bg-white/10 rounded mb-3" />
              <div className="h-3 w-full bg-white/10 rounded mb-2" />
              <div className="h-3 w-4/5 bg-white/10 rounded" />
            </div>
          )}

          <VotingArena
            userId={currentUser?.uid}
            currentUser={currentUser}
            activeWarzoneId={actions.activeWarzone}
            sessionOverride={actions.sessionOverride}
            arenaAnimationsPaused={setupGate.isSetupMounted || isProtocolOpen}
            onOpenWarzoneSelect={() => {
              if (!isGuest && !isProtocolOpen) setupGate.openWarzoneClaimModal();
            }}
            onExportStart={() => actions.setTickerPausedForExport(true)}
            onExportEnd={() => actions.setTickerPausedForExport(false)}
          />

          {actions.deepLinkNotice && (
            <div className="fixed top-[calc(var(--safe-top)+64px)] left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full text-xs bg-black/80 border border-king-gold/40 text-king-gold shadow-lg">
              {actions.deepLinkNotice}
            </div>
          )}

          <div className="space-y-2">
            <UniversalBreakingBanner />
            <div className="flex justify-end">
              <Link
                to="/breaking-history"
                aria-label={t("viewAllBreakingHistory")}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-king-gold/30 bg-transparent text-king-gold/90 hover:bg-king-gold/10 hover:border-king-gold/50 transition-colors text-sm font-medium"
              >
                <Archive className="w-4 h-4 shrink-0" aria-hidden />
                {t("viewAllBreakingHistory")}
              </Link>
            </div>
          </div>

          <SentimentDataProvider
            filters={stableFilters}
            authorized={isAnalystAuthorized}
            remainingPoints={remainingPoints}
            consumePoint={consumePoint}
            onEnergyExhausted={onEnergyExhausted}
          >
            <section className="relative" aria-label={t("globalStats")}>
              {analystAdPortal}
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-king-gold">
                  {t("globalStats")}
                </h2>
                {typeof remainingPoints === "number" && (
                  <div className="relative">
                    <div
                      className={`flex items-center gap-1 bg-white/5 border border-white/10 px-2 py-1 rounded-full text-[11px] text-machine-silver/80 ${
                        actions.energyPing ? "animate-intel-ping" : ""
                      } ${remainingPoints > 0 ? "animate-[pulse_4s_ease-in-out_infinite]" : ""}`}
                      title={t("energyExpiryHint")}
                    >
                      <span aria-hidden="true">⚡</span>
                      <span>{remainingPoints}</span>
                      <Info className="w-3 h-3 text-machine-silver/60" aria-hidden="true" />
                    </div>
                  </div>
                )}
              </div>
              <SentimentStats filters={stableFilters} />
              <AnalystGate
                authorized={isAnalystAuthorized}
                onRequestRewardAd={onRequestRewardAd}
                userId={currentUser?.uid}
                cooldownMinutes={10}
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
                      actions.setFilterDrawerOpen(true);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-villain-purple/40 text-sm text-gray-300 hover:text-king-gold hover:border-king-gold/50"
                    aria-label={t("openFilter")}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    {t("filter")}
                  </button>
                </div>
                <FilterFunnel
                  open={actions.filterDrawerOpen}
                  onClose={() => actions.setFilterDrawerOpen(false)}
                  filters={stableFilters}
                  onFiltersChange={actions.setFilters}
                  authorized={isAnalystAuthorized}
                  scrollTargetId="pulse-map-section"
                />
                <div id="pulse-map-section" className="mb-6">
                  <PulseMap filters={stableFilters} onFiltersChange={actions.setFilters} />
                </div>
                <div className="mt-6">
                  <AnalyticsDashboard
                    authorized={isAnalystAuthorized}
                    filters={stableFilters}
                  />
                </div>
              </AnalystGate>
            </section>
          </SentimentDataProvider>
        </motion.main>
      </WarzoneDataProvider>

      {/* ── Protocol Overlay ────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {isProtocolOpen && (
          <ProtocolOverlay open={isProtocolOpen} onComplete={completeProtocol} />
        )}
      </AnimatePresence>

      {/* ── 戰區登錄 Modal ───────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {currentUser?.uid && setupGate.isSetupMounted && (
          <UserProfileSetup
            key="profile-setup-modal"
            onClose={setupGate.dismissProfileSetup}
            onSaved={setupGate.dismissProfileSetup}
            userId={currentUser?.uid}
            initialStep={1}
            initialProfile={{ ...(profile ?? {}), voterTeam: actions.activeWarzone }}
          />
        )}
      </AnimatePresence>

      {/* ── 重置立場廣告準備中提示 ─────────────────────────────── */}
      <AdPreloadOverlay open={revoteAdLoading} adContext="extra_vote" />

      {/* ── 設定 / 刪帳 / 重設立場 Modal 群 ────────────────────── */}
      <VoteModals
        settings={settingsModals}
        profile={profile}
        authError={authError}
        clearAuthError={clearAuthError}
        replayProtocol={replayProtocol}
        t={t}
        isGuest={isGuest}
      />
    </div>
  );
}
