/**
 * useVoteActions — 投票頁面行為層
 *
 * 設計意圖：
 *   1. 集中管理「不屬於 Modal 狀態機」的所有頁面行為：
 *      Deep Link 戰區選擇、篩選器、LiveTicker 暫停、Guest 冷啟動、能量動畫、進場動畫。
 *   2. stableFilters 以 useMemo 保持參照穩定，防止 SentimentDataProvider 無謂重渲染。
 *   3. energyPing 動畫：只在 remainingPoints 「下降」時觸發，
 *      避免 onSnapshot 每次刷新都重播動畫造成視覺雜訊。
 *   4. votePageIntroDone 鎖定：進場動畫完成後，後續 Modal 的 AnimatePresence enter/exit
 *      不會重播 VotePage 的 header / main initial 動畫（WebView 重播感問題）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WARZONE_ID = "LAL";
const DEEP_LINK_NOTICE_MS = 2600;
const GUEST_BOOTSTRAP_MS = 380;
const ENERGY_PING_MS = 450;

/**
 * @param {object} params
 * @param {boolean} params.isGuest
 * @param {URLSearchParams} params.searchParams
 * @param {string|undefined} params.voterTeam - profile?.voterTeam
 * @param {number|undefined} params.remainingPoints
 * @param {() => Promise<void>} params.signOut
 * @param {import('react-router-dom').NavigateFunction} params.navigate
 * @param {(key: string) => string} params.t
 */
export function useVoteActions({
  isGuest,
  searchParams,
  voterTeam,
  remainingPoints,
  signOut,
  navigate,
  t,
}) {
  // ---- Warzone / Deep Link ----
  const [activeWarzone, setActiveWarzone] = useState(
    voterTeam ?? DEFAULT_WARZONE_ID,
  );
  const [sessionOverride, setSessionOverride] = useState(false);
  const [deepLinkNotice, setDeepLinkNotice] = useState("");
  const hasHandledDeepLinkRef = useRef(false);

  // Deep Link 消費：warzoneId 參數一律收斂至 LBJ 主戰區
  useEffect(() => {
    const warzoneFromUrl = searchParams.get("warzoneId");
    if (!warzoneFromUrl) {
      setSessionOverride(false);
      setActiveWarzone((prev) => prev || voterTeam || DEFAULT_WARZONE_ID);
      return;
    }
    setSessionOverride(true);
    setActiveWarzone(DEFAULT_WARZONE_ID);
    if (!hasHandledDeepLinkRef.current) {
      hasHandledDeepLinkRef.current = true;
      setDeepLinkNotice(t("deepLinkWarzoneSwitchedLbj"));
    }
  }, [searchParams, voterTeam, t]);

  // 提示自動淡出
  useEffect(() => {
    if (!deepLinkNotice) return;
    const timer = window.setTimeout(() => setDeepLinkNotice(""), DEEP_LINK_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [deepLinkNotice]);

  // ---- 篩選器 ----
  const [filters, setFilters] = useState({});
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const stableFilters = useMemo(() => ({ ...filters }), [filters]);

  // ---- LiveTicker 暫停（BattleCard 匯出期間） ----
  const [tickerPausedForExport, setTickerPausedForExport] = useState(false);

  // ---- 訪客冷啟動 skeleton（降低白屏感）----
  const [isGuestBootstrapLoading, setIsGuestBootstrapLoading] = useState(false);
  useEffect(() => {
    if (!isGuest) {
      setIsGuestBootstrapLoading(false);
      return;
    }
    setIsGuestBootstrapLoading(true);
    const timer = window.setTimeout(
      () => setIsGuestBootstrapLoading(false),
      GUEST_BOOTSTRAP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isGuest]);

  // ---- 進場動畫完成鎖定 ----
  const [votePageIntroDone, setVotePageIntroDone] = useState(false);
  const markIntroDone = useCallback(() => {
    setVotePageIntroDone((done) => (done ? done : true));
  }, []);

  // ---- Intelligence HUD 能量點動畫 ----
  const [energyPing, setEnergyPing] = useState(false);
  const lastEnergyRef = useRef(remainingPoints);
  useEffect(() => {
    let timeoutId;
    if (typeof remainingPoints !== "number") {
      lastEnergyRef.current = remainingPoints;
    } else {
      const prev = lastEnergyRef.current;
      if (typeof prev === "number" && remainingPoints < prev) {
        setEnergyPing(true);
        timeoutId = window.setTimeout(() => setEnergyPing(false), ENERGY_PING_MS);
      }
      lastEnergyRef.current = remainingPoints;
    }
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [remainingPoints]);

  // ---- 訪客切換登入（先登出再跳頁，避免 Firebase 匿名持久化繞過 ProtectedRoute） ----
  const handleGuestToLogin = useCallback(async () => {
    try {
      await signOut();
    } finally {
      navigate("/", { replace: true });
    }
  }, [signOut, navigate]);

  return {
    // Warzone
    activeWarzone,
    sessionOverride,
    deepLinkNotice,
    // Filters
    filters,
    setFilters,
    stableFilters,
    filterDrawerOpen,
    setFilterDrawerOpen,
    // Export
    tickerPausedForExport,
    setTickerPausedForExport,
    // UX states
    isGuestBootstrapLoading,
    votePageIntroDone,
    markIntroDone,
    energyPing,
    // Actions
    handleGuestToLogin,
  };
}
