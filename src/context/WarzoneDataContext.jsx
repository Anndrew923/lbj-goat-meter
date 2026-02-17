/**
 * WarzoneDataContext — 數據指揮部：全球聚合數據唯一訂閱與分發
 *
 * 設計意圖（極致節流）：
 * - 僅在此處開啟「唯一一個」對 warzoneStats/global_summary 的 onSnapshot 監聽。
 * - SentimentStats、AnalyticsDashboard、LiveTicker、PulseMap 一律從本 Context 取數，嚴禁再掃描 votes 集合。
 * - 進入投票頁時 Firebase Fetching Log 僅出現 1 次。
 */
import { createContext, useContext, useEffect, useMemo, useState, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, isFirebaseReady } from "../lib/firebase";
import { GLOBAL_SUMMARY_DOC_ID } from "../lib/constants";

const WarzoneDataContext = createContext(null);

/** 預設聚合結構，與 global_summary 欄位對齊 */
const DEFAULT_SUMMARY = {
  totalVotes: 0,
  goat: 0,
  fraud: 0,
  king: 0,
  mercenary: 0,
  machine: 0,
  stat_padder: 0,
  recentVotes: [],
  reasonCountsLike: {},
  reasonCountsDislike: {},
  countryCounts: {},
};

export function WarzoneDataProvider({ children }) {
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const unsubRef = useRef(null);

  useEffect(() => {
    if (!isFirebaseReady || !db) {
      setSummary(DEFAULT_SUMMARY);
      setLoading(false);
      setError(null);
      return;
    }
    const ref = doc(db, "warzoneStats", GLOBAL_SUMMARY_DOC_ID);
    if (import.meta.env.DEV) {
      console.log("Firebase Fetching [WarzoneDataContext] warzoneStats/global_summary (唯一聚合監聽)");
    }
    unsubRef.current = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setSummary(DEFAULT_SUMMARY);
          setLoading(false);
          setError(null);
          return;
        }
        const data = snap.data();
        const recentVotes = Array.isArray(data.recentVotes) ? data.recentVotes : [];
        const reasonCountsLike = typeof data.reasonCountsLike === "object" && data.reasonCountsLike !== null && !Array.isArray(data.reasonCountsLike) ? data.reasonCountsLike : {};
        const reasonCountsDislike = typeof data.reasonCountsDislike === "object" && data.reasonCountsDislike !== null && !Array.isArray(data.reasonCountsDislike) ? data.reasonCountsDislike : {};
        const countryCounts = typeof data.countryCounts === "object" && data.countryCounts !== null && !Array.isArray(data.countryCounts) ? data.countryCounts : {};
        setSummary({
          totalVotes: typeof data.totalVotes === "number" ? data.totalVotes : 0,
          goat: typeof data.goat === "number" ? data.goat : 0,
          fraud: typeof data.fraud === "number" ? data.fraud : 0,
          king: typeof data.king === "number" ? data.king : 0,
          mercenary: typeof data.mercenary === "number" ? data.mercenary : 0,
          machine: typeof data.machine === "number" ? data.machine : 0,
          stat_padder: typeof data.stat_padder === "number" ? data.stat_padder : 0,
          recentVotes,
          reasonCountsLike,
          reasonCountsDislike,
          countryCounts,
        });
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setSummary(DEFAULT_SUMMARY);
        setLoading(false);
        if (import.meta.env.DEV) {
          console.warn("[WarzoneDataContext] onSnapshot error:", err?.message ?? err);
        }
      }
    );
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      summary,
      recentVotes: summary.recentVotes ?? [],
      loading,
      error,
    }),
    [summary, loading, error]
  );

  return (
    <WarzoneDataContext.Provider value={value}>
      {children}
    </WarzoneDataContext.Provider>
  );
}

export function useWarzoneData() {
  const ctx = useContext(WarzoneDataContext);
  if (ctx == null) {
    throw new Error("useWarzoneData must be used within WarzoneDataProvider");
  }
  return ctx;
}
