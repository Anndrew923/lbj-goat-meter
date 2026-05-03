/**
 * lib/constants.js — 向後相容 re-export barrel
 *
 * 解耦意圖：
 * - 此檔案已完成三層拆分：stanceCore / appConfig / lbjConstants。
 * - 保留此 barrel 確保尚未遷移的隱性引用不會在部署時崩潰（過渡期安全網）。
 * - 新程式碼請直接引用具體模組；此檔案不再接受新的 export 宣告。
 */
export * from './stanceCore.js'
export * from './appConfig.js'
export * from './lbjConstants.js'
