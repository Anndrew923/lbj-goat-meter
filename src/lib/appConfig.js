/**
 * lib/appConfig.js — App 身份識別與 Firebase 路徑配置
 *
 * 解耦意圖：
 * - 此檔案是「換皮」的唯一接縫點。未來將 goat_meter 遷移至「社會風向計」等其他專案時，
 *   只需替換此檔案的值，所有引用 PROJECT_APP_ID / STAR_ID 的組件即自動適配新主題。
 * - GLOBAL_EVENTS_COLLECTION / GLOBAL_SUMMARY_DOC_ID 是 Firestore 路徑字串，
 *   集中於此確保路徑只有一個定義，避免散落在各組件的字串拼接出現拼寫錯誤。
 * - RECON_AUTHORIZED_COLOR 是 App 級的品牌色，與立場顏色（STANCE_COLORS）刻意分離：
 *   立場色隨立場系統走，RECON 色是 UI 偵查授權燈的固定品牌色。
 */

/** 球星／主體識別碼（對應 Firestore votes.starId 欄位） */
export const STAR_ID = 'lbj'

/** App 識別碼（對應 global_events.target_app 欄位），用於多 App 共存同一 Firestore 時的過濾 */
export const PROJECT_APP_ID = 'goat_meter'

/** Firestore 全域聚合文件 ID（warzoneStats/global_summary） */
export const GLOBAL_SUMMARY_DOC_ID = 'global_summary'

/** Firestore 突發戰區集合名稱（跨 App 共用，以 target_app 欄位區隔） */
export const GLOBAL_EVENTS_COLLECTION = 'global_events'

/** 偵查授權指示燈色（戰術美金綠），與 FilterFunnel / VotePage RECON 燈一致 */
export const RECON_AUTHORIZED_COLOR = '#00E676'
