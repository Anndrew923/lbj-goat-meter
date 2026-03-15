/**
 * SentimentDataContext — 向後相容層：委派至 GlobalSentimentContext
 *
 * 設計意圖：SentimentStats、PulseMap、AnalyticsDashboard 共用同一組 votes 查詢（單一數據源）。
 * 實作已遷移至 GlobalSentimentContext；此檔案僅保留相同 API，確保既有 import 無需變更。
 */
export {
  GlobalSentimentProvider as SentimentDataProvider,
  useGlobalSentimentContext as useSentimentDataContext,
} from "./GlobalSentimentContext";
