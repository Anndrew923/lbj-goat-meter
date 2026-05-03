/**
 * lib/stanceCore.js — 投票領域模型（立場鍵、分類規則、聚合結構）
 *
 * 解耦意圖：
 * - 此檔案定義「這個 App 的投票維度是什麼」，是投票系統的骨架。
 * - 與業務資料（REASONS_BY_STANCE）和 App 身份（PROJECT_APP_ID）刻意分離：
 *   未來如果立場從 6 個改為 8 個，只需改此一處，聚合計算自動反映。
 * - getInitialGlobalSummary 以 STANCE_KEYS 動態生成初始結構，
 *   確保新增立場時不會遺漏 Firestore 聚合文件的欄位初始化。
 * - 遷移至「社會風向計」等其他專案時，此檔案整體替換為新的立場定義即可。
 */

/** 六大立場對抗版（對應 Firestore votes.status 欄位值） */
export const STANCES = [
  { value: 'goat', theme: 'king-gold' },
  { value: 'fraud', theme: 'villain-purple' },
  { value: 'king', theme: 'crown-red' },
  { value: 'mercenary', theme: 'tactical-emerald' },
  { value: 'machine', theme: 'machine-silver' },
  { value: 'stat_padder', theme: 'rust-copper' },
]

/** Firestore 欄位鍵列表，與 STANCES 順序一致，供聚合計數與白名單驗證使用 */
export const STANCE_KEYS = STANCES.map((s) => s.value)

/** Firestore Security Rules 白名單，需與 STANCE_KEYS 保持同步（firestore.rules 的 isValidVote 需手動更新） */
export const FIRESTORE_STATUS_WHITELIST = STANCE_KEYS

/** 初始 global_summary 結構（無中生有／預熱用），由 STANCE_KEYS 動態生成，新增立場自動包含 */
export function getInitialGlobalSummary() {
  return {
    totalVotes: 0,
    recentVotes: [],
    reasonCountsLike: {},
    reasonCountsDislike: {},
    countryCounts: {},
    ...Object.fromEntries(STANCE_KEYS.map((k) => [k, 0])),
  }
}

/** 粉方立場（pro）：地圖 pro 計數、原因熱點「喜歡」分類 */
export const PRO_STANCES = new Set(['goat', 'king', 'machine'])

/** 黑方立場（anti）：地圖 anti 計數、原因熱點「不喜歡」分類 */
export const ANTI_STANCES = new Set(['fraud', 'stat_padder', 'mercenary'])

/** 立場 → 主題色（hex），供 StanceCards / BattleCard 霓虹描邊動態聯動 */
export const STANCE_COLORS = {
  goat: '#D4AF37',
  fraud: '#4B0082',
  king: '#B42832',
  mercenary: '#00E676',
  machine: '#E0E0E0',
  stat_padder: '#B87333',
}

/** 理由視覺權重：high 讓核心論點在 UI 上脫穎而出 */
export const REASON_WEIGHT = Object.freeze({ HIGH: 'high', NORMAL: 'normal' })

/** 理由分類：供未來篩選、標籤雲、或雷達圖分組使用 */
export const REASON_CATEGORY = Object.freeze({
  HONORS: 'honors',
  CONTROVERSY: 'controversy',
  STATS: 'stats',
  LEADERSHIP: 'leadership',
  LEGACY: 'legacy',
  NARRATIVE: 'narrative',
})

/** 多選上限：強迫用戶選出「最精華」論點，避免理由堆砌 */
export const REASONS_MAX_SELECT = 3
