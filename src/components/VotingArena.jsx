/**
 * VotingArena — 投票競技場（暗黑競技風）
 * 六大立場對抗版：雙層語義（primary 大寫粗體英文 + secondary 細體中文），
 * 所有文案經 t() 讀取，禁止硬編碼；GOAT 金閃／FRAUD 紫碎動畫。
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { getReasonsForStance, getReasonLabels } from "../i18n/i18n";
import { REASONS_MAX_SELECT } from "../lib/constants";
import { triggerHaptic } from "../utils/hapticUtils";
import { submitVote as voteServiceSubmitVote } from "../services/VoteService";
import { Share2 } from "lucide-react";
import BattleCardContainer from "./BattleCardContainer";
import LoginPromptModal from "./LoginPromptModal";
import AdMobPortal from "./AdMobPortal";
import StanceCards from "./StanceCards";

/** Fisher–Yates shuffle，不改動原陣列，用於每次選立場時隨機排序理由，確保每個理由都有機會被看到。 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 原因標籤選中時是否用紫色系（反方） */
function isAntiStance(stance) {
  return (
    stance === "fraud" || stance === "stat_padder" || stance === "mercenary"
  );
}

export default function VotingArena({ userId, currentUser, onOpenWarzoneSelect, onExportStart, onExportEnd }) {
  const { t, i18n } = useTranslation(["arena", "common"]);
  const { isGuest, profile, profileLoading, hasProfile, revote } = useAuth();
  /** 已登入但未完成 Profile（半登錄）：顯示投票卡，點擊時攔截並引導完成戰區登錄 */
  const isLimboUser = Boolean(userId) && !isGuest && !hasProfile;
  /** 是否已選擇戰區：profile 存在且 voterTeam 非空，投票必歸屬 16 戰區之一 */
  const hasSelectedWarzone = Boolean(
    profile?.voterTeam && String(profile.voterTeam).trim() !== ""
  );
  const [selectedStance, setSelectedStance] = useState(null);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [voteSuccess, setVoteSuccess] = useState(false);
  const [showBattleCard, setShowBattleCard] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [goatFlash, setGoatFlash] = useState(false);
  const [fraudShatter, setFraudShatter] = useState(false);
  const animationTimeouts = useRef([]);
  const [revoking, setRevoking] = useState(false);
  const [revoteError, setRevoteError] = useState(null);
  const revoteExitRef = useRef(false);
  const [revoteCompleteKey, setRevoteCompleteKey] = useState(0);
  const [showAdPortal, setShowAdPortal] = useState(false);
  const [showSaveReportConfirm, setShowSaveReportConfirm] = useState(false);
  const [saveReportPending, setSaveReportPending] = useState(false);
  const pendingOnWatchedRef = useRef(null);
  const battleCardContainerRef = useRef(null);

  /** 廣告解鎖：點擊下載時開啟 AdMobPortal，插頁關閉後執行解鎖並可選擇是否存檔至相簿。 */
  const onRequestRewardAd = useCallback((onWatched) => {
    pendingOnWatchedRef.current = onWatched;
    setShowAdPortal(true);
  }, []);

  const hasVoted = profile?.hasVoted === true || voteSuccess;
  const canSubmit =
    profile &&
    hasSelectedWarzone &&
    !hasVoted &&
    selectedStance &&
    selectedReasons.length > 0;

  /** 每次選定立場或語系變更時重算：隨機排序理由並取得當前語系文案，確保每個理由都有機會被看到且當輪順序穩定。 */
  const reasons = useMemo(
    () =>
      selectedStance ? shuffle(getReasonsForStance(selectedStance)) : [],
    [selectedStance, i18n.language],
  );

  useEffect(() => {
    return () => {
      const timeouts = animationTimeouts.current;
      if (timeouts && Array.isArray(timeouts)) timeouts.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    setSelectedReasons([]);
  }, [selectedStance]);

  useEffect(() => {
    if (hasVoted && !revoteExitRef.current) setShowBattleCard(true);
  }, [hasVoted]);

  useEffect(() => {
    if (profile?.hasVoted === true && voteSuccess) setVoteSuccess(false);
  }, [profile?.hasVoted, voteSuccess]);

  useEffect(() => {
    if (!showSaveReportConfirm || saveReportPending) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setShowSaveReportConfirm(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSaveReportConfirm, saveReportPending]);

  const toggleReason = (value) => {
    setSelectedReasons((prev) => {
      if (prev.includes(value)) return prev.filter((r) => r !== value);
      if (prev.length >= REASONS_MAX_SELECT) return prev;
      return [...prev, value];
    });
  };

  const handleRevote = async () => {
    if (!userId || revoking) return;
    setRevoteError(null);
    setRevoking(true);
    try {
      await revote(false);
      revoteExitRef.current = true;
      setShowBattleCard(false);
    } catch (err) {
      const msg =
        err && typeof err.message === "string"
          ? err.message
          : t("common:revoteError");
      setRevoteError(msg);
    } finally {
      setRevoking(false);
    }
  };

  const handleRevoteRetry = () => {
    setRevoteError(null);
    handleRevote();
  };

  const handleRevoteComplete = () => {
    if (revoteExitRef.current) {
      revoteExitRef.current = false;
      setVoteSuccess(false);
      setSelectedStance(null);
      setSelectedReasons([]);
      setRevoteCompleteKey((k) => k + 1);
    }
  };

  const handleStanceSelect = (value) => {
    if (isGuest || isLimboUser) {
      setShowLoginPrompt(true);
      return;
    }
    animationTimeouts.current.forEach(clearTimeout);
    animationTimeouts.current = [];
    if (value === "goat") {
      setGoatFlash(true);
      animationTimeouts.current.push(
        setTimeout(() => setGoatFlash(false), 600),
      );
    } else if (value === "fraud") {
      setFraudShatter(true);
      animationTimeouts.current.push(
        setTimeout(() => setFraudShatter(false), 800),
      );
    }
    triggerHaptic(10);
    setSelectedStance(value);
  };

  const handleSubmit = async () => {
    if (!userId || !canSubmit || !profile) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await voteServiceSubmitVote(
        userId,
        { selectedStance, selectedReasons },
        (key) => t(key)
      );
      triggerHaptic(50);
      setVoteSuccess(true);
      setShowBattleCard(true);
    } catch (err) {
      triggerHaptic([30, 50, 30]);
      const msg =
        err?.message != null && typeof err.message === "string"
          ? err.message
          : t("common:submitError");
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 狀態分流：A. 已登入且有 Profile → 下方正常投票／已投票 UI；B. 匿名 (isGuest) → 引導登入；C. 半登錄 (isLimboUser) → 顯示卡但點擊攔截
  if (profileLoading && userId) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-8 text-center">
        <p className="text-king-gold animate-pulse" role="status">
          {t("common:loadingArena")}
        </p>
      </div>
    );
  }

  /** C. 已登入但無 Profile (isLimboUser)：顯示投票卡，點擊時攔截並引導完成戰區登錄 */
  if (isLimboUser) {
    return (
      <>
        <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
          <h3 className="text-lg font-bold text-king-gold mb-2">
            {t("common:chooseStance")}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {t("common:completeProfileFirst")}
          </p>
          <StanceCards
            selectedStance={null}
            onSelect={() => setShowLoginPrompt(true)}
            disabled={false}
          />
          <motion.button
            type="button"
            onClick={() => {
              setShowLoginPrompt(false);
              onOpenWarzoneSelect?.();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full mt-4 py-3 rounded-lg bg-king-gold text-black font-bold shadow-lg shadow-king-gold/20 hover:shadow-king-gold/30 transition-shadow"
            aria-label={t("common:completeWarzonePromptButton")}
          >
            {t("common:completeWarzonePromptButton")}
          </motion.button>
        </div>
        <LoginPromptModal
          open={showLoginPrompt}
          onClose={() => setShowLoginPrompt(false)}
          variant="limbo"
          onCompleteWarzone={() => onOpenWarzoneSelect?.()}
        />
      </>
    );
  }

  if (isGuest) {
    return (
      <>
        <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
          <h3 className="text-lg font-bold text-king-gold mb-2">
            {t("common:chooseStance")}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {t("common:loginToVoteHint")}
          </p>
          <StanceCards
            selectedStance={null}
            onSelect={() => setShowLoginPrompt(true)}
            disabled={false}
          />
        </div>
        <LoginPromptModal
          open={showLoginPrompt}
          onClose={() => setShowLoginPrompt(false)}
        />
      </>
    );
  }

  if (profile && !hasVoted && !hasSelectedWarzone) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border-2 border-king-gold/60 bg-gradient-to-b from-king-gold/10 to-villain-purple/10 p-8 text-center"
      >
        <div className="mb-6">
          <h3 className="text-2xl font-black tracking-tight text-king-gold uppercase">
            {t("common:claimYourWarzone")}
          </h3>
          <p className="mt-3 text-gray-300 text-sm max-w-sm mx-auto">
            {t("common:claimYourWarzoneDesc")}
          </p>
        </div>
        <motion.button
          type="button"
          onClick={() => onOpenWarzoneSelect?.()}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          className="w-full max-w-xs mx-auto py-4 px-6 rounded-xl bg-king-gold text-black font-bold text-lg shadow-lg shadow-king-gold/30 hover:shadow-king-gold/50 transition-shadow"
          aria-label={t("common:openWarzoneSelect")}
        >
          {t("common:openWarzoneSelect")}
        </motion.button>
      </motion.div>
    );
  }

  if (hasVoted) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-king-gold/40 bg-gray-900/80 p-8 text-center"
        >
          <p className="text-king-gold font-semibold">
            {t("common:alreadyVoted")}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            {t("common:thanksVoted")}
          </p>
          <motion.button
            type="button"
            onClick={() => setShowBattleCard(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="mt-4 px-6 py-2.5 rounded-full font-bold bg-gradient-to-r from-king-gold to-king-gold/80 text-black shadow-lg shadow-king-gold/20 transition-all inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-king-gold focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            aria-label={t("common:viewMyBattleCard")}
          >
            <Share2 className="w-4 h-4 shrink-0" aria-hidden />
            {t("common:viewMyBattleCard")}
          </motion.button>
        </motion.div>
        <AnimatePresence mode="wait" onExitComplete={handleRevoteComplete}>
          {showBattleCard && (
            <BattleCardContainer
              ref={battleCardContainerRef}
              key="battle-card"
              open={showBattleCard}
              onClose={() => setShowBattleCard(false)}
              onRevote={handleRevote}
              revoking={revoking}
              revoteError={revoteError}
              onRevoteReload={handleRevoteRetry}
              photoURL={currentUser?.photoURL}
              displayName={currentUser?.displayName ?? currentUser?.email}
              voterTeam={profile?.voterTeam}
              status={profile?.currentStance ?? selectedStance}
              reasonLabels={getReasonLabels(
                profile?.currentStance ?? selectedStance,
                Array.isArray(profile?.currentReasons)
                  ? profile.currentReasons
                  : (selectedReasons ?? []),
              )}
              city={profile?.city}
              country={profile?.country}
              rankLabel={
                profile?.city
                  ? t("common:rankLabelWithCity", { city: profile.city })
                  : t("common:rankLabel")
              }
              exit={{ opacity: 0, scale: 0.8 }}
              onRequestRewardAd={onRequestRewardAd}
              onExportStart={onExportStart}
              onExportEnd={onExportEnd}
            />
          )}
        </AnimatePresence>
        <AdMobPortal
          open={showAdPortal}
          onWatched={() => {
            pendingOnWatchedRef.current?.();
            pendingOnWatchedRef.current = null;
            setShowAdPortal(false);
            setShowSaveReportConfirm(true);
          }}
          onClose={() => setShowAdPortal(false)}
        />
        {showSaveReportConfirm && (
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-report-confirm-title"
            onClick={() => !saveReportPending && setShowSaveReportConfirm(false)}
          >
            <motion.div
              className="rounded-xl border-2 border-king-gold/50 bg-gray-900 p-6 max-w-sm w-full shadow-xl shadow-king-gold/10"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="save-report-confirm-title" className="text-lg font-bold text-king-gold mb-4">
                {t("common:saveReportToGalleryPrompt")}
              </h2>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowSaveReportConfirm(false)}
                  disabled={saveReportPending}
                  className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-50"
                >
                  {t("common:saveReportToGalleryLater")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setSaveReportPending(true);
                    try {
                      await battleCardContainerRef.current?.saveToGallery?.();
                      setShowSaveReportConfirm(false);
                    } catch (err) {
                      console.error("[VotingArena] save to gallery failed", err);
                      setShowSaveReportConfirm(false);
                    } finally {
                      setSaveReportPending(false);
                    }
                  }}
                  disabled={saveReportPending}
                  className="flex-1 py-2 rounded-lg bg-king-gold text-black font-semibold hover:bg-king-gold/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saveReportPending ? t("common:saveReportToGallerySaving") : t("common:saveReportToGalleryConfirm")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </>
    );
  }

  const anti = isAntiStance(selectedStance);

  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
      <h3 className="text-lg font-bold text-king-gold mb-4">
        {t("common:chooseStance")}
      </h3>

      <motion.div
        key={revoteCompleteKey}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="mb-4"
      >
        <StanceCards
          selectedStance={selectedStance}
          onSelect={handleStanceSelect}
          goatFlash={goatFlash}
          fraudShatter={fraudShatter}
        />
      </motion.div>

      <AnimatePresence mode="wait">
        {selectedStance && (
          <motion.div
            key={selectedStance}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4"
          >
            <p className="text-sm text-gray-400 mb-2" id="choose-reasons-hint">
              {t("common:chooseReasons")}
              <span className="ml-1 text-gray-500">
                （{t("common:chooseReasonsMax", { max: REASONS_MAX_SELECT })}）
              </span>
            </p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-labelledby="choose-reasons-hint"
            >
              {reasons.map(({ value, secondary, weight }) => {
                const isSelected = selectedReasons.includes(value);
                const atMax = selectedReasons.length >= REASONS_MAX_SELECT;
                const disabled = !isSelected && atMax;
                return (
                  <motion.button
                    key={value}
                    type="button"
                    onClick={() => toggleReason(value)}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    aria-label={secondary}
                    whileHover={!disabled ? { scale: 1.05 } : {}}
                    whileTap={!disabled ? { scale: 0.95 } : {}}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      weight === "high" ? "font-semibold" : ""
                    } ${
                      isSelected
                        ? anti
                          ? "bg-villain-purple/70 text-white"
                          : "bg-king-gold/80 text-black"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    {secondary}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {submitError && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {submitError}
        </p>
      )}

      <motion.button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        whileHover={canSubmit ? { scale: 1.02 } : {}}
        whileTap={canSubmit ? { scale: 0.98 } : {}}
        className="w-full mt-3 py-3 rounded-lg bg-king-gold text-black font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? t("common:submitting") : t("common:submitVote")}
      </motion.button>
    </div>
  );
}
