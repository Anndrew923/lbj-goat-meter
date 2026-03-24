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
import { getDeviceId } from "../utils/deviceId";
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

/**
 * @param {object} props
 * @param {() => void} [props.onExportUnlock] 廣告解鎖完成時通知父層（可選）
 */
export default function VotingArena({
  userId,
  currentUser,
  onOpenWarzoneSelect,
  onExportStart,
  onExportEnd,
  onExportUnlock,
  activeWarzoneId,
  sessionOverride = false,
}) {
  const { t, i18n } = useTranslation(["arena", "common"]);
  const { isGuest, profile, profileLoading, hasProfile, revote } = useAuth();
  /** 已登入但未完成 Profile（半登錄）：顯示投票卡，點擊時攔截並引導完成戰區登錄 */
  const isLimboUser = Boolean(userId) && !isGuest && !hasProfile;
  /** Deep Link Session 覆蓋優先於 profile，確保「所點即所得」能即時反映在 UI。 */
  const effectiveWarzoneId =
    (sessionOverride && typeof activeWarzoneId === "string" && activeWarzoneId.trim()) ||
    (typeof profile?.voterTeam === "string" && profile.voterTeam.trim()) ||
    "";
  /**
   * 是否已選擇戰區（可提交門檻）：
   * 仍以 profile.voterTeam 為準，避免僅靠 session 覆蓋就觸發提交，導致後端 transaction 回傳 warzone required。
   */
  const hasSelectedWarzone = Boolean(
    typeof profile?.voterTeam === "string" && profile.voterTeam.trim()
  );
  const [selectedStance, setSelectedStance] = useState(null);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
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
  const pendingOnWatchedRef = useRef(null);
  const battleCardContainerRef = useRef(null);
  const lastSubmitAtRef = useRef(0);

  /** 廣告解鎖：點擊下載時開啟 AdMobPortal；插頁關閉後先直接存相簿，結束後再執行解鎖回調（見 handleInterstitialWatched）。 */
  const onRequestRewardAd = useCallback((onWatched) => {
    pendingOnWatchedRef.current = onWatched;
    setShowAdPortal(true);
  }, []);

  /**
   * 插頁關閉：關閉 portal 後「直接」await saveToGallery（無任何中間確認 Modal）；
   * 解鎖回調僅在存檔流程結束後執行，避免解鎖先觸發重繪與殘留 UI。
   */
  const handleInterstitialWatched = useCallback(async () => {
    const unlock = pendingOnWatchedRef.current;
    pendingOnWatchedRef.current = null;
    setShowAdPortal(false);
    try {
      await battleCardContainerRef.current?.saveToGallery?.();
    } catch (err) {
      console.error("[VotingArena] save to gallery after ad failed", err);
    } finally {
      unlock?.();
    }
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
    [selectedStance, i18n.language], // eslint-disable-line react-hooks/exhaustive-deps -- getReasonsForStance 使用 i18n，語系變更需重算
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

  const toggleReason = (value) => {
    if (isProcessing) return;
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
    if (isProcessing) return;
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
    if (!userId || !canSubmit || !profile || isProcessing) return;

    const now = Date.now();
    if (now - lastSubmitAtRef.current < 1500) {
      // 防抖：1.5 秒內多次點擊僅接受第一次，避免重複觸發 Cloud Function。
      return;
    }
    lastSubmitAtRef.current = now;

    setSubmitting(true);
    setIsProcessing(true);
    setSubmitError(null);
    try {
      await voteServiceSubmitVote(
        userId,
        { selectedStance, selectedReasons, deviceId: getDeviceId() },
        (key) => t(key)
      );
      triggerHaptic(50);
      setVoteSuccess(true);
      setShowBattleCard(true);
    } catch (err) {
      triggerHaptic([30, 50, 30]);
      const message =
        err && typeof err.message === "string"
          ? err.message
          : t("common:submitError");
      setSubmitError(message);
    } finally {
      setSubmitting(false);
      setIsProcessing(false);
    }
  };

  // 外殼包裝（Wrapper）模式：單一出口，依 contentMode 渲染 DynamicContent，確保上層可固定插入突發戰區入口等區塊
  const contentMode =
    profileLoading && userId
      ? "loading"
      : isLimboUser
        ? "limbo"
        : isGuest
          ? "guest"
          : profile && !hasVoted && !hasSelectedWarzone
            ? "no_warzone"
            : hasVoted
              ? "voted"
              : "form";

  const anti = isAntiStance(selectedStance);

  return (
    <>
      {/* Supernova 外殼：雷達流光邊框（與突發戰區共用語彙），將內層能量場與卡片包裹在同一個高對比容器中。 */}
      <div className="voting-arena-wrapper relative isolate overflow-hidden rounded-2xl p-[3px] bg-gradient-to-br from-king-gold via-red-500 to-king-gold bg-[length:200%_200%] animate-border-beam shadow-[0_0_40px_rgba(255,191,0,0.4)] motion-reduce:animate-none">
        <div className="relative overflow-hidden rounded-[1.1rem] bg-gray-950/90 backdrop-blur-xl">
          {/* Version 2 Supernova 能量場：提高透明度並加入旋轉層，模擬恆星噴發感但仍保持文字可讀性。 */}
          <div
            className="absolute inset-0 z-0 animate-energy-flow pointer-events-none motion-reduce:animate-none"
            style={{
              background:
                "linear-gradient(-45deg, rgba(212,175,55,0.85), rgba(180,40,50,0.7), rgba(75,0,130,0.85), rgba(212,175,55,0.7))",
              backgroundSize: "400% 400%",
            }}
            aria-hidden
          />
          {/* 旋轉輻射層：單純負責色彩噴發與流動感，與主流光分離，避免影響 Tailwind 動畫設定。 */}
          <div
            className="absolute -inset-16 z-0 pointer-events-none animate-spin-slow motion-reduce:animate-none"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(212,175,55,0.15), rgba(180,40,50,0.3), rgba(75,0,130,0.25), rgba(212,175,55,0.15))",
              filter: "blur(18px)",
            }}
            aria-hidden
          />
          {/* 金色戰術網格：金屬化強化，opacity 0.25 */}
          <div
            className="absolute inset-0 z-0 opacity-[0.25] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle, #d4af37 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
            aria-hidden
          />
          {/* 內容層：Declaration、StanceCards、按鈕等，確保繪製在背景之上 */}
          <div className="relative z-10">
        {/* 主戰場宣言：王座審判風格，上下細線裝飾強化沈浸感 */}
        <div className="border-y border-king-gold/20 py-3 my-4" aria-hidden>
          <p className="italic text-king-gold/90 text-sm text-center tracking-wide">
            {t("common:arenaDeclaration")}
          </p>
        </div>
        {contentMode === "loading" && (
          <div className="rounded-xl border border-villain-purple/30 bg-gray-950/90 backdrop-blur-xl p-8 text-center">
            <p className="text-king-gold animate-pulse" role="status">
              {t("common:loadingArena")}
            </p>
          </div>
        )}
        {contentMode === "limbo" && (
          <div className="rounded-xl border border-villain-purple/30 bg-gray-950/90 backdrop-blur-xl p-6">
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
        )}
        {contentMode === "guest" && (
          <div className="rounded-xl border border-villain-purple/30 bg-gray-950/90 backdrop-blur-xl p-6">
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
        )}
        {contentMode === "no_warzone" && (
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
        )}
        {contentMode === "voted" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-king-gold/40 bg-gray-950/90 backdrop-blur-xl p-8 text-center"
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
        )}
        {contentMode === "form" && (
          <div className="rounded-xl border border-villain-purple/30 bg-gray-950/90 backdrop-blur-xl p-6">
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
                disabled={isProcessing}
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
                          disabled={disabled || isProcessing}
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
              disabled={!canSubmit || submitting || isProcessing}
              whileHover={canSubmit && !isProcessing ? { scale: 1.05 } : {}}
              whileTap={canSubmit && !isProcessing ? { scale: 0.95 } : {}}
              className={`w-full mt-3 py-3 rounded-lg bg-king-gold text-black font-bold transition-transform disabled:opacity-50 disabled:cursor-not-allowed ${canSubmit && !submitting && !isProcessing ? "animate-pulse" : ""}`}
            >
              {submitting || isProcessing
                ? t("common:submittingWithAudit")
                : t("common:submitVote")}
            </motion.button>
            {/* 戰前信心暗示：減少用戶對於灌票的疑慮，提升單次投票的心理價值；極低調樣式避免干擾主流程。 */}
            <p className="mt-2 text-[10px] text-gray-500/60 text-center" aria-hidden>
              {isProcessing
                ? t("common:security_verified_hint_audit")
                : t("common:security_verified_hint")}
            </p>
          </div>
        )}
          </div>
        </div>
      </div>

      {/* Limbo / Guest 共用：登入／完成戰區引導 Modal */}
      <LoginPromptModal
        open={showLoginPrompt}
        onClose={() => setShowLoginPrompt(false)}
        variant={contentMode === "limbo" ? "limbo" : undefined}
        onCompleteWarzone={contentMode === "limbo" ? () => onOpenWarzoneSelect?.() : undefined}
      />

      {/* 已投票流程：戰報卡、廣告解鎖後自動存檔 */}
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
            voterTeam={effectiveWarzoneId}
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
            onExportUnlock={onExportUnlock}
            onExportStart={onExportStart}
            onExportEnd={onExportEnd}
          />
        )}
      </AnimatePresence>
      <AdMobPortal
        open={showAdPortal}
        onWatched={handleInterstitialWatched}
        onClose={() => setShowAdPortal(false)}
      />
    </>
  );
}
