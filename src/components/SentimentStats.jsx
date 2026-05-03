/**
 * SentimentStats — 全球戰報大盤（Global Pulse）
 * 無篩選時用 WarzoneDataContext（global_summary）；有篩選時用 SentimentDataContext 動態結果，與雷達／動畫一致。
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useWarzoneData } from "../context/WarzoneDataContext";
import { useSentimentDataContext } from "../context/SentimentDataContext";
import { hasActiveFilters } from "../hooks/useSentimentData";
import { hasValidAppCheck } from "../lib/firebase";
import { getStancesForArena } from "../i18n/i18n";
import { STANCE_COLORS } from "../lib/stanceCore"
import { RECON_AUTHORIZED_COLOR } from "../lib/appConfig";
/** 未知／其他立場的進度條 fallback 色（與 gray-500 一致） */
const FALLBACK_BAR_COLOR = "#6b7280";
/** 動態計數器動畫時長（ms） */
const COUNTER_DURATION_MS = 600;

/**
 * 將各項 count 分配為整數百分比，加總精確等於 100%（消除浮點誤差）。
 * @param {{ key: string, label: string, count: number }[]} rows
 * @returns {{ key: string, label: string, count: number, pct: number }[]}
 */
function normalizePctTo100(rows) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return rows.map((r) => ({ ...r, pct: 0 }));
  const withFloor = rows.map((r) => {
    const raw = (100 * r.count) / total;
    return { ...r, raw, floor: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  const sumFloor = withFloor.reduce((s, r) => s + r.floor, 0);
  let remainder = 100 - sumFloor;
  const byFrac = [...withFloor].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder && i < byFrac.length; i++) byFrac[i].floor += 1;
  return withFloor.map((r) => ({
    key: r.key,
    label: r.label,
    count: r.count,
    pct: r.floor,
  }));
}

/** 數字滾動上升動畫：從當前顯示值過渡到 target，營造動態匯入感 */
function useAnimatedCount(target) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const displayRef = useRef(0);

  displayRef.current = display;

  useEffect(() => {
    const startValue = displayRef.current;
    if (target === startValue) return;
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / COUNTER_DURATION_MS, 1);
      const easeOut = 1 - (1 - t) ** 2;
      const next = Math.round(startValue + (target - startValue) * easeOut);
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return display;
}

export default function SentimentStats({ filters = {} }) {
  const { t, i18n } = useTranslation("common");
  const { summary, loading, error } = useWarzoneData();
  const hasFilters = hasActiveFilters(filters);
  const { summary: sentimentSummary, loading: sentimentLoading, error: sentimentError } = useSentimentDataContext();

  const isEnglish = i18n.language?.startsWith("en");

  const displayData = useMemo(() => {
    if (hasFilters && sentimentSummary) return sentimentSummary;
    return summary;
  }, [hasFilters, sentimentSummary, summary]);

  const stats = useMemo(() => {
    const total = displayData.totalVotes ?? 0;
    const byStatus = {
      goat: displayData.goat ?? 0,
      fraud: displayData.fraud ?? 0,
      king: displayData.king ?? 0,
      mercenary: displayData.mercenary ?? 0,
      machine: displayData.machine ?? 0,
      stat_padder: displayData.stat_padder ?? 0,
    };
    return { total, byStatus, otherCount: 0 };
  }, [displayData]);

  const rowsWithPct = useMemo(() => {
    const orderedStanceRows = getStancesForArena();
    const rows = orderedStanceRows.map((s) => ({
      key: s.value,
      label: s.primary ?? s.value,
      count: stats.byStatus[s.value] ?? 0,
    }));
    if (stats.otherCount > 0) {
      rows.push({ key: "other", label: t("other"), count: stats.otherCount });
    }
    return normalizePctTo100(rows);
  }, [stats, t]);

  const totalVotesDisplay = useAnimatedCount(stats.total);
  const isLoading = hasFilters ? sentimentLoading : loading;
  const loadError = hasFilters ? sentimentError : error;

  const loadErrorMessage = useMemo(() => {
    if (!loadError) return null;
    const msg = loadError?.message ?? "";
    if (msg === "AUTH_REQUIRED") return t("sentimentError_authRequired");
    if (msg === "FUNCTIONS_NOT_READY") return t("sentimentError_functionsNotReady");
    return t("loadErrorTryAgain");
  }, [loadError, t]);

  if (loading && !hasFilters) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-king-gold animate-pulse" role="status">
          {t("loadingGlobalData")}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6">
        <p className="text-red-400" role="alert">
          {loadErrorMessage ?? t("loadErrorTryAgain")}
        </p>
      </div>
    );
  }

  const renderBar = (statusKey, label, count, pct) => {
    const barColor = STANCE_COLORS[statusKey] ?? FALLBACK_BAR_COLOR;
    return (
      <motion.div
        key={statusKey}
        initial={false}
        animate={{ opacity: 1 }}
        className="flex items-center gap-3"
      >
        <span className="min-w-[70px] shrink-0 text-sm text-gray-300">
          {label}
        </span>
        <div className="flex-1 h-6 rounded-full bg-gray-800 overflow-hidden min-w-0">
          <motion.div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{ backgroundColor: barColor }}
            initial={{ width: "0%" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </div>
        <span className="min-w-[30px] shrink-0 text-right text-sm text-gray-400">
          {count}
        </span>
      </motion.div>
    );
  };

  /** 數據權威標籤：僅在 App Check 有效時顯示綠色呼吸燈＋文案，異常時隱藏，確保數據透明度。 */
  const showVerifiedBadge = hasValidAppCheck();

  return (
    <div
      className={`rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6 transition-opacity duration-200 ${isLoading && hasFilters ? "opacity-50 pointer-events-none" : ""}`}
      aria-busy={isLoading && hasFilters}
    >
      {/* 標題與脈衝燈／公信力區：flex-wrap + no-shrink，確保英文長字串在窄螢幕也不重疊。 */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2 sm:flex-nowrap sm:items-start">
        <h3 className="shrink-0 text-lg font-bold text-king-gold leading-tight max-w-full sm:max-w-[80%] min-w-0 pr-4 break-words">
          {t("globalVoteDistribution")}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0 self-start sm:self-auto" aria-hidden>
          <span
            className={`font-medium tracking-widest uppercase animate-pulse whitespace-nowrap min-w-max flex-shrink-0 ${
              isEnglish ? "text-[10px]" : "text-[11px] sm:text-xs"
            }`}
            style={{ color: RECON_AUTHORIZED_COLOR }}
          >
            GLOBAL PULSE: LIVE
          </span>
          {showVerifiedBadge && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
              <span
                className={`font-medium tracking-widest uppercase text-green-500/90 whitespace-nowrap min-w-max flex-shrink-0 ${
                  isEnglish ? "text-[10px]" : "text-[11px] sm:text-xs"
                }`}
              >
                {t("verified_data_status")}
              </span>
            </div>
          )}
        </div>
      </div>
      <p
        className="text-sm text-gray-400 mb-4"
        aria-live="polite"
        aria-atomic="true"
      >
        {t("totalVotesCount", { count: totalVotesDisplay })}
      </p>
      <div className="space-y-3">
        {rowsWithPct.map(({ key, label, count, pct }) =>
          renderBar(key, label, count, pct),
        )}
      </div>
    </div>
  );
}
