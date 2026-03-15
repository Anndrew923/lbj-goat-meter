/**
 * GlobalSentimentContext — 單一數據源：votes 查詢唯一訂閱與分發
 *
 * 設計意圖（Cost Efficiency First）：
 * - 將「主要 votes 查詢」集中於此 Context，由單一 Provider 發起一次 useSentimentData。
 * - SentimentStats、AnalyticsDashboard、PulseMap 一律從本 Context 消費，禁止各自呼叫 useSentimentData。
 * - 當三組件同時掛載時，Firebase 僅收到 1 次 votes 相關查詢請求（getDocs + session cache），
 *   避免重複讀取與多條「Firebase Fetching」log。
 *
 * 與 useSentimentData 的關係：
 * - useSentimentData 內部為 getDocs + useBarometerQuery（debounce + session cache），非 onSnapshot。
 * - 本 Context 僅在內部呼叫一次 useSentimentData(filters, options)，並將 summary / loading / error 分發給子組件。
 */
import { createContext, useContext, useMemo } from "react";
import { useSentimentData, hasActiveFilters, EMPTY_FILTERS } from "../hooks/useSentimentData";

const GlobalSentimentContext = createContext(null);

/** 未在 Provider 下時的回退值；消費端可用 summary === null 判斷並改用 Warzone 靜態數據 */
const DEFAULT_VALUE = {
  summary: null,
  loading: false,
  error: null,
};

/**
 * 單一數據源 Provider：僅在此處執行一次 votes 查詢（useSentimentData），子組件透過 useGlobalSentimentContext 讀取。
 * 僅在 VotePage 使用，包住 SentimentStats / PulseMap / AnalyticsDashboard。
 */
export function GlobalSentimentProvider({
  filters = EMPTY_FILTERS,
  authorized = true,
  remainingPoints = null,
  consumePoint,
  onEnergyExhausted,
  children,
}) {
  const hasFilters = hasActiveFilters(filters);
  // 無篩選時不發送 votes 查詢，大盤由 WarzoneDataContext 提供；有篩選時僅此處發起一次查詢，子組件共用
  const { summary, loading, error } = useSentimentData(
    hasFilters ? filters : EMPTY_FILTERS,
    {
      enabled: hasFilters && authorized,
      remainingPoints,
      consumePoint,
      onEnergyExhausted,
    }
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
    <GlobalSentimentContext.Provider value={value}>
      {children}
    </GlobalSentimentContext.Provider>
  );
}

/**
 * 供 SentimentStats、PulseMap、AnalyticsDashboard 使用。
 * 回傳 { summary, loading, error }；未在 Provider 下時為 DEFAULT_VALUE。
 */
export function useGlobalSentimentContext() {
  const ctx = useContext(GlobalSentimentContext);
  return ctx ?? DEFAULT_VALUE;
}
