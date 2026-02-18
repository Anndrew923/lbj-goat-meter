/**
 * SentimentDataContext — 篩選條件下 votes 訂閱的單一來源
 *
 * 設計意圖：SentimentStats、PulseMap、AnalyticsDashboard 共用同一組 useSentimentData 訂閱，
 * 避免同一篩選觸發三份 Firestore 查詢與三條 log。由 VotePage 以 SentimentDataProvider 包住區塊並傳入 filters。
 */
import { createContext, useContext, useMemo } from "react";
import { useSentimentData, hasActiveFilters, EMPTY_FILTERS } from "../hooks/useSentimentData";

const SentimentDataContext = createContext(null);

const DEFAULT_VALUE = {
  summary: null,
  loading: false,
  error: null,
};

/**
 * 僅在 VotePage 使用，包住 SentimentStats / PulseMap / AnalyticsDashboard，傳入當前 filters。
 * 內部只呼叫一次 useSentimentData，子組件從 Context 讀取，故一次篩選只會有一筆訂閱與一條 log。
 */
export function SentimentDataProvider({ filters = EMPTY_FILTERS, children }) {
  const hasFilters = hasActiveFilters(filters);
  const { summary, loading, error } = useSentimentData(
    hasFilters ? filters : EMPTY_FILTERS,
    { enabled: hasFilters }
  );

  const value = useMemo(
    () => ({
      summary: summary ?? null,
      loading: hasFilters ? loading : false,
      error: hasFilters ? error : null,
    }),
    [hasFilters, summary, loading, error]
  );

  return (
    <SentimentDataContext.Provider value={value}>
      {children}
    </SentimentDataContext.Provider>
  );
}

/**
 * 供 SentimentStats、PulseMap、AnalyticsDashboard 使用。
 * 回傳 { summary, loading, error }；未在 Provider 下時為 DEFAULT_VALUE（summary 為 null，用 Warzone 靜態數據）。
 */
export function useSentimentDataContext() {
  const ctx = useContext(SentimentDataContext);
  return ctx ?? DEFAULT_VALUE;
}
