/**
 * 戰區登錄與投票用常數 — 球隊以城市＋代表色暗示，避免官方 Logo 以符合法律避險。
 */

export const AGE_GROUPS = [
  { value: '18-24', label: '18–24 歲' },
  { value: '25-34', label: '25–34 歲' },
  { value: '35-44', label: '35–44 歲' },
  { value: '45+', label: '45 歲以上' },
]

export const GENDERS = [
  { value: 'm', label: '男性' },
  { value: 'f', label: '女性' },
  { value: 'o', label: '其他' },
]

/**
 * 球隊選項：僅存 value（Firestore 用）與 i18n key，不硬編碼任何語系文字。
 * 共 16 項含「其他」；城市與代表色由 teams.<id>.city / teams.<id>.colors 翻譯鍵提供。
 */
export const TEAMS = [
  { id: 'lakers', value: 'LAL', cityKey: 'teams.lakers.city', colorKey: 'teams.lakers.colors' },
  { id: 'warriors', value: 'GSW', cityKey: 'teams.warriors.city', colorKey: 'teams.warriors.colors' },
  { id: 'celtics', value: 'BOS', cityKey: 'teams.celtics.city', colorKey: 'teams.celtics.colors' },
  { id: 'heat', value: 'MIA', cityKey: 'teams.heat.city', colorKey: 'teams.heat.colors' },
  { id: 'cavaliers', value: 'CLE', cityKey: 'teams.cavaliers.city', colorKey: 'teams.cavaliers.colors' },
  { id: 'bulls', value: 'CHI', cityKey: 'teams.bulls.city', colorKey: 'teams.bulls.colors' },
  { id: 'knicks', value: 'NYK', cityKey: 'teams.knicks.city', colorKey: 'teams.knicks.colors' },
  { id: 'bucks', value: 'MIL', cityKey: 'teams.bucks.city', colorKey: 'teams.bucks.colors' },
  { id: 'suns', value: 'PHX', cityKey: 'teams.suns.city', colorKey: 'teams.suns.colors' },
  { id: 'mavericks', value: 'DAL', cityKey: 'teams.mavericks.city', colorKey: 'teams.mavericks.colors' },
  { id: 'nuggets', value: 'DEN', cityKey: 'teams.nuggets.city', colorKey: 'teams.nuggets.colors' },
  { id: 'sixers', value: 'PHI', cityKey: 'teams.sixers.city', colorKey: 'teams.sixers.colors' },
  { id: 'raptors', value: 'TOR', cityKey: 'teams.raptors.city', colorKey: 'teams.raptors.colors' },
  { id: 'spurs', value: 'SAS', cityKey: 'teams.spurs.city', colorKey: 'teams.spurs.colors' },
  { id: 'thunder', value: 'OKC', cityKey: 'teams.thunder.city', colorKey: 'teams.thunder.colors' },
  { id: 'other', value: 'OTHER', cityKey: 'teams.other.city', colorKey: 'teams.other.colors' },
]

/** 依 value（如 LAL）取得城市翻譯鍵，供 BattleCard / LiveTicker / Filter 等使用，語系切換時自動更新 */
export function getTeamCityKey(value) {
  const team = TEAMS.find((t) => t.value === value)
  return team ? team.cityKey : 'teams.other.city'
}

/**
 * 戰區主題色（primary / secondary hex），供 BattleCard 動態背景與浮水印。
 * 僅使用城市＋代表色描述，無官方隊徽。Fallback 為 LBJ 金與深紅。
 */
export const TEAM_COLORS = {
  LAL: { primary: '#FDB927', secondary: '#552583' },
  GSW: { primary: '#FFC72C', secondary: '#1D428A' },
  BOS: { primary: '#007A33', secondary: '#BA9653' },
  MIA: { primary: '#98002E', secondary: '#000000' },
  CLE: { primary: '#860038', secondary: '#041E42' },
  CHI: { primary: '#CE1141', secondary: '#000000' },
  NYK: { primary: '#F58426', secondary: '#006BB6' },
  MIL: { primary: '#00471B', secondary: '#EEE1C6' },
  PHX: { primary: '#E56020', secondary: '#1D1160' },
  DAL: { primary: '#00538C', secondary: '#002B5E' },
  DEN: { primary: '#0E2240', secondary: '#FEC524' },
  PHI: { primary: '#006BB6', secondary: '#ED174C' },
  TOR: { primary: '#CE1141', secondary: '#000000' },
  SAS: { primary: '#C4CED4', secondary: '#000000' },
  OKC: { primary: '#007AC1', secondary: '#EF3B24' },
  OTHER: { primary: '#6B7280', secondary: '#374151' },
}
/** 無戰區時使用 LBJ 金與深紅 */
export const BATTLE_CARD_DEFAULT_COLORS = { primary: '#D4AF37', secondary: '#8B0000' }

/** 常用國家（ISO 代碼），供選單與 IP 定位結果對應 */
export const COUNTRIES = [
  { value: 'TW', label: '台灣' },
  { value: 'US', label: '美國' },
  { value: 'JP', label: '日本' },
  { value: 'KR', label: '韓國' },
  { value: 'CN', label: '中國' },
  { value: 'HK', label: '香港' },
  { value: 'GB', label: '英國' },
  { value: 'PH', label: '菲律賓' },
  { value: 'AU', label: '澳洲' },
  { value: 'CA', label: '加拿大' },
  { value: 'DE', label: '德國' },
  { value: 'FR', label: '法國' },
  { value: 'OTHER', label: '其他' },
]

/** 投票戰場：六大立場對抗版（對應 votes.status）；視覺意圖：金／紫／皇冠紅／戰術螢光綠／科技銀／鐵鏽銅 */
export const STANCES = [
  { value: 'goat', theme: 'king-gold' },
  { value: 'fraud', theme: 'villain-purple' },
  { value: 'king', theme: 'crown-red' },
  { value: 'mercenary', theme: 'tactical-emerald' },
  { value: 'machine', theme: 'machine-silver' },
  { value: 'stat_padder', theme: 'rust-copper' },
]

/** 偵查授權指示燈色（戰術美金綠），與 FilterFunnel / VotePage RECON 燈一致 */
export const RECON_AUTHORIZED_COLOR = '#00E676'

/** 立場 → 主題色（hex），供 StanceCards / BattleCard 霓虹與描邊聯動 */
export const STANCE_COLORS = {
  goat: '#D4AF37',
  fraud: '#4B0082',
  king: '#B42832',
  mercenary: '#00E676', // Tactical Emerald — 利益與美金的象徵
  machine: '#E0E0E0', // Cyber Silver — 機械化高冷質感
  stat_padder: '#B87333',
}

/**
 * 立場理由矩陣 — 懂行級 LBJ 生涯註解（Architecture First）
 *
 * 設計意圖：不以簡單字串陣列呈現，改為「物件矩陣」以便：
 * - Key：寫入 Firestore votes.reasons 的識別碼，便於分析與儀表板聚合。
 * - Label：對應 i18n 鍵值（arena.reasons.<stance>.<key>），語系檔內為 primary / secondary。
 * - Weight：視覺權重（high = 略大/加亮，normal = 預設），讓核心論點脫穎而出。
 * - Category：歸類（honors / controversy / stats / leadership / legacy 等），供未來篩選或標籤雲分組。
 *
 * 每個理由的選取都有辯論意圖：例如 FRAUD 的 2011 總決賽是無法繞過的爭議核心，
 * GOAT 的 1-3 逆轉與 4-1-1 是正面論述的支柱，MERCENARY 的 LeGM 則對應社群梗與道德爭議。
 */
export const REASON_WEIGHT = Object.freeze({ HIGH: 'high', NORMAL: 'normal' })
export const REASON_CATEGORY = Object.freeze({
  HONORS: 'honors',
  CONTROVERSY: 'controversy',
  STATS: 'stats',
  LEADERSHIP: 'leadership',
  LEGACY: 'legacy',
  NARRATIVE: 'narrative',
})

/** 多選上限：強迫用戶選出「最精華」的論點，避免理由堆砌。 */
export const REASONS_MAX_SELECT = 3

export const REASONS_BY_STANCE = {
  goat: [
    { key: 'comeback_2016', labelKey: 'reasons.goat.comeback_2016', weight: 'high', category: 'honors' },
    { key: '411_first', labelKey: 'reasons.goat.411_first', weight: 'high', category: 'stats' },
    { key: 'eight_finals', labelKey: 'reasons.goat.eight_finals', weight: 'high', category: 'honors' },
    { key: 'death_stare_2012', labelKey: 'reasons.goat.death_stare_2012', weight: 'normal', category: 'legacy' },
    { key: 'ultimate_answer', labelKey: 'reasons.goat.ultimate_answer', weight: 'normal', category: 'legacy' },
  ],
  king: [
    { key: 'highest_iq', labelKey: 'reasons.king.highest_iq', weight: 'high', category: 'leadership' },
    { key: '2018_solo', labelKey: 'reasons.king.2018_solo', weight: 'high', category: 'honors' },
    { key: 'floor_general', labelKey: 'reasons.king.floor_general', weight: 'normal', category: 'leadership' },
    { key: 'oldest_allstar', labelKey: 'reasons.king.oldest_allstar', weight: 'normal', category: 'stats' },
    { key: 'kid_from_akron', labelKey: 'reasons.king.kid_from_akron', weight: 'normal', category: 'legacy' },
  ],
  machine: [
    { key: 'body_investment', labelKey: 'reasons.machine.body_investment', weight: 'high', category: 'stats' },
    { key: '22_years_peak', labelKey: 'reasons.machine.22_years_peak', weight: 'high', category: 'stats' },
    { key: '27_7_7', labelKey: 'reasons.machine.27_7_7', weight: 'normal', category: 'stats' },
    { key: 'playoffs_pts_king', labelKey: 'reasons.machine.playoffs_pts_king', weight: 'normal', category: 'stats' },
    { key: 'the_block', labelKey: 'reasons.machine.the_block', weight: 'normal', category: 'honors' },
  ],
  fraud: [
    { key: '2011_finals', labelKey: 'reasons.fraud.2011_finals', weight: 'high', category: 'controversy' },
    { key: 'the_decision', labelKey: 'reasons.fraud.the_decision', weight: 'high', category: 'controversy' },
    { key: 'leflop', labelKey: 'reasons.fraud.leflop', weight: 'normal', category: 'controversy' },
    { key: 'passing_clutch', labelKey: 'reasons.fraud.passing_clutch', weight: 'normal', category: 'controversy' },
    { key: 'finals_4_6', labelKey: 'reasons.fraud.finals_4_6', weight: 'high', category: 'stats' },
  ],
  mercenary: [
    { key: 'superteam_era', labelKey: 'reasons.mercenary.superteam_era', weight: 'high', category: 'controversy' },
    { key: 'legm', labelKey: 'reasons.mercenary.legm', weight: 'high', category: 'controversy' },
    { key: 'ring_chaser', labelKey: 'reasons.mercenary.ring_chaser', weight: 'normal', category: 'narrative' },
    { key: 'no_loyalty', labelKey: 'reasons.mercenary.no_loyalty', weight: 'normal', category: 'narrative' },
    { key: 'coach_killer', labelKey: 'reasons.mercenary.coach_killer', weight: 'normal', category: 'controversy' },
  ],
  stat_padder: [
    { key: '40k_hunter', labelKey: 'reasons.stat_padder.40k_hunter', weight: 'high', category: 'stats' },
    { key: 'garbage_time', labelKey: 'reasons.stat_padder.garbage_time', weight: 'normal', category: 'stats' },
    { key: 'walking_defense', labelKey: 'reasons.stat_padder.walking_defense', weight: 'normal', category: 'controversy' },
    { key: 'ball_dominant', labelKey: 'reasons.stat_padder.ball_dominant', weight: 'normal', category: 'narrative' },
    { key: 'stats_over_wins', labelKey: 'reasons.stat_padder.stats_over_wins', weight: 'high', category: 'narrative' },
  ],
}
