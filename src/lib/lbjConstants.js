/**
 * lib/lbjConstants.js — LBJ / NBA 業務資料（應用場景專屬）
 *
 * 解耦意圖：
 * - 此檔案存放所有「只有 LeBron James 這個主題才有意義」的業務資料。
 * - 遷移至「社會風向計」或其他主題時，此整個檔案被替換，不影響 stanceCore / appConfig。
 * - TEAMS / TEAM_COLORS 僅存代表色，不含官方 Logo，符合法律避險原則。
 * - REASONS_BY_STANCE 是 LBJ 辯論理由矩陣，每條理由均有 key（Firestore 用）、
 *   labelKey（i18n 用）、weight（視覺權重）、category（分類），未來可擴展為雷達圖或標籤雲。
 */

/** 年齡層選項（用戶 Profile 篩選） */
export const AGE_GROUPS = [
  { value: '18-24', label: '18–24 歲' },
  { value: '25-34', label: '25–34 歲' },
  { value: '35-44', label: '35–44 歲' },
  { value: '45+', label: '45 歲以上' },
]

/** 性別選項（用戶 Profile 篩選） */
export const GENDERS = [
  { value: 'm', label: '男性' },
  { value: 'f', label: '女性' },
  { value: 'o', label: '其他' },
]

/**
 * NBA 球隊選項：僅存 value（Firestore 用）與 i18n key，不硬編碼任何語系文字。
 * 共 30+1 項含「其他」；城市與代表色由 teams.<id>.city / teams.<id>.colors 翻譯鍵提供。
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
  { id: 'clippers', value: 'LAC', cityKey: 'teams.clippers.city', colorKey: 'teams.clippers.colors' },
  { id: 'timberwolves', value: 'MIN', cityKey: 'teams.timberwolves.city', colorKey: 'teams.timberwolves.colors' },
  { id: 'kings', value: 'SAC', cityKey: 'teams.kings.city', colorKey: 'teams.kings.colors' },
  { id: 'rockets', value: 'HOU', cityKey: 'teams.rockets.city', colorKey: 'teams.rockets.colors' },
  { id: 'grizzlies', value: 'MEM', cityKey: 'teams.grizzlies.city', colorKey: 'teams.grizzlies.colors' },
  { id: 'pelicans', value: 'NOP', cityKey: 'teams.pelicans.city', colorKey: 'teams.pelicans.colors' },
  { id: 'trailblazers', value: 'POR', cityKey: 'teams.trailblazers.city', colorKey: 'teams.trailblazers.colors' },
  { id: 'jazz', value: 'UTA', cityKey: 'teams.jazz.city', colorKey: 'teams.jazz.colors' },
  { id: 'nets', value: 'BKN', cityKey: 'teams.nets.city', colorKey: 'teams.nets.colors' },
  { id: 'hawks', value: 'ATL', cityKey: 'teams.hawks.city', colorKey: 'teams.hawks.colors' },
  { id: 'hornets', value: 'CHA', cityKey: 'teams.hornets.city', colorKey: 'teams.hornets.colors' },
  { id: 'pistons', value: 'DET', cityKey: 'teams.pistons.city', colorKey: 'teams.pistons.colors' },
  { id: 'pacers', value: 'IND', cityKey: 'teams.pacers.city', colorKey: 'teams.pacers.colors' },
  { id: 'magic', value: 'ORL', cityKey: 'teams.magic.city', colorKey: 'teams.magic.colors' },
  { id: 'wizards', value: 'WAS', cityKey: 'teams.wizards.city', colorKey: 'teams.wizards.colors' },
  { id: 'other', value: 'OTHER', cityKey: 'teams.other.city', colorKey: 'teams.other.colors' },
]

/** 依 value（如 LAL）取得城市翻譯鍵，供 BattleCard / LiveTicker / Filter 使用，語系切換時自動更新 */
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
  LAC: { primary: '#C8102E', secondary: '#1D428A' },
  MIN: { primary: '#78BE20', secondary: '#0C2340' },
  SAC: { primary: '#FFC72C', secondary: '#5A2D81' },
  HOU: { primary: '#C8102E', secondary: '#002D62' },
  MEM: { primary: '#E85D04', secondary: '#5D76A9' },
  NOP: { primary: '#0EA5E9', secondary: '#0F172A' },
  POR: { primary: '#E03A3E', secondary: '#000000' },
  UTA: { primary: '#F9A01B', secondary: '#002B5C' },
  BKN: { primary: '#0057B8', secondary: '#000000' },
  ATL: { primary: '#E03A3E', secondary: '#FDB927' },
  CHA: { primary: '#00788C', secondary: '#1D428A' },
  DET: { primary: '#ED174C', secondary: '#007DC3' },
  IND: { primary: '#FDBB30', secondary: '#002D62' },
  ORL: { primary: '#0077C0', secondary: '#C8102E' },
  WAS: { primary: '#C8102E', secondary: '#002B5C' },
  OTHER: { primary: '#6B7280', secondary: '#374151' },
}

/** BattleCard 無戰區時的預設色（LBJ 金與深紅） */
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

/**
 * LBJ 立場理由矩陣 — 懂行級生涯註解
 *
 * 每條理由：
 * - key：寫入 Firestore votes.reasons 的識別碼，供分析與儀表板聚合
 * - labelKey：i18n 鍵值（arena.reasons.<stance>.<key>）
 * - weight：視覺權重（high = 核心論點，略大/加亮）
 * - category：分類，供未來篩選、標籤雲或雷達圖分組
 */
export const REASONS_BY_STANCE = {
  goat: [
    { key: 'comeback_2016', labelKey: 'reasons.goat.comeback_2016', weight: 'high', category: 'honors' },
    { key: '411_first', labelKey: 'reasons.goat.411_first', weight: 'high', category: 'stats' },
    { key: 'eight_finals', labelKey: 'reasons.goat.eight_finals', weight: 'high', category: 'honors' },
    { key: 'death_stare_2012', labelKey: 'reasons.goat.death_stare_2012', weight: 'normal', category: 'legacy' },
    { key: 'ultimate_answer', labelKey: 'reasons.goat.ultimate_answer', weight: 'normal', category: 'legacy' },
    { key: 'three_team_fmvp', labelKey: 'reasons.goat.three_team_fmvp', weight: 'high', category: 'honors' },
    { key: 'ist_winner', labelKey: 'reasons.goat.ist_winner', weight: 'normal', category: 'honors' },
    { key: 'redeem_team_gold', labelKey: 'reasons.goat.redeem_team_gold', weight: 'normal', category: 'honors' },
    { key: 'playoff_win_shares', labelKey: 'reasons.goat.playoff_win_shares', weight: 'normal', category: 'stats' },
    { key: 'all_nba_20_times', labelKey: 'reasons.goat.all_nba_20_times', weight: 'high', category: 'stats' },
  ],
  king: [
    { key: 'highest_iq', labelKey: 'reasons.king.highest_iq', weight: 'high', category: 'leadership' },
    { key: '2018_solo', labelKey: 'reasons.king.2018_solo', weight: 'high', category: 'honors' },
    { key: 'floor_general', labelKey: 'reasons.king.floor_general', weight: 'normal', category: 'leadership' },
    { key: 'oldest_allstar', labelKey: 'reasons.king.oldest_allstar', weight: 'normal', category: 'stats' },
    { key: 'kid_from_akron', labelKey: 'reasons.king.kid_from_akron', weight: 'normal', category: 'legacy' },
    { key: 'on_court_coach', labelKey: 'reasons.king.on_court_coach', weight: 'normal', category: 'leadership' },
    { key: 'point_forward', labelKey: 'reasons.king.point_forward', weight: 'normal', category: 'legacy' },
    { key: 'i_promise', labelKey: 'reasons.king.i_promise', weight: 'normal', category: 'legacy' },
    { key: 'tactical_evolution', labelKey: 'reasons.king.tactical_evolution', weight: 'normal', category: 'leadership' },
    { key: 'court_vision_elite', labelKey: 'reasons.king.court_vision_elite', weight: 'normal', category: 'leadership' },
    { key: 'teammate_maximized', labelKey: 'reasons.king.teammate_maximized', weight: 'high', category: 'leadership' },
  ],
  machine: [
    { key: 'body_investment', labelKey: 'reasons.machine.body_investment', weight: 'high', category: 'stats' },
    { key: '22_years_peak', labelKey: 'reasons.machine.22_years_peak', weight: 'high', category: 'stats' },
    { key: '27_7_7', labelKey: 'reasons.machine.27_7_7', weight: 'normal', category: 'stats' },
    { key: 'playoffs_pts_king', labelKey: 'reasons.machine.playoffs_pts_king', weight: 'normal', category: 'stats' },
    { key: 'the_block', labelKey: 'reasons.machine.the_block', weight: 'normal', category: 'honors' },
    { key: 'all_time_scoring_king', labelKey: 'reasons.machine.all_time_scoring_king', weight: 'high', category: 'stats' },
    { key: 'aged_like_wine', labelKey: 'reasons.machine.aged_like_wine', weight: 'normal', category: 'stats' },
    { key: 'iron_body', labelKey: 'reasons.machine.iron_body', weight: 'normal', category: 'stats' },
    { key: '1200_game_streak', labelKey: 'reasons.machine.1200_game_streak', weight: 'normal', category: 'stats' },
    { key: 'minutes_leader_all_time', labelKey: 'reasons.machine.minutes_leader_all_time', weight: 'normal', category: 'stats' },
  ],
  fraud: [
    { key: '2011_finals', labelKey: 'reasons.fraud.2011_finals', weight: 'high', category: 'controversy' },
    { key: 'the_decision', labelKey: 'reasons.fraud.the_decision', weight: 'high', category: 'controversy' },
    { key: 'leflop', labelKey: 'reasons.fraud.leflop', weight: 'normal', category: 'controversy' },
    { key: 'passing_clutch', labelKey: 'reasons.fraud.passing_clutch', weight: 'normal', category: 'controversy' },
    { key: 'finals_4_6', labelKey: 'reasons.fraud.finals_4_6', weight: 'high', category: 'stats' },
    { key: '2004_olympic_bronze', labelKey: 'reasons.fraud.2004_olympic_bronze', weight: 'normal', category: 'controversy' },
    { key: '2010_jersey_toss', labelKey: 'reasons.fraud.2010_jersey_toss', weight: 'normal', category: 'controversy' },
    { key: '2007_swept', labelKey: 'reasons.fraud.2007_swept', weight: 'high', category: 'stats' },
  ],
  mercenary: [
    { key: 'superteam_era', labelKey: 'reasons.mercenary.superteam_era', weight: 'high', category: 'controversy' },
    { key: 'legm', labelKey: 'reasons.mercenary.legm', weight: 'high', category: 'controversy' },
    { key: 'ring_chaser', labelKey: 'reasons.mercenary.ring_chaser', weight: 'normal', category: 'narrative' },
    { key: 'no_loyalty', labelKey: 'reasons.mercenary.no_loyalty', weight: 'normal', category: 'narrative' },
    { key: 'coach_killer', labelKey: 'reasons.mercenary.coach_killer', weight: 'normal', category: 'controversy' },
    { key: 'draft_asset_depletion', labelKey: 'reasons.mercenary.draft_asset_depletion', weight: 'normal', category: 'controversy' },
    { key: 'market_jumper', labelKey: 'reasons.mercenary.market_jumper', weight: 'normal', category: 'narrative' },
    { key: 'klutch_empire', labelKey: 'reasons.mercenary.klutch_empire', weight: 'normal', category: 'controversy' },
  ],
  stat_padder: [
    { key: '40k_hunter', labelKey: 'reasons.stat_padder.40k_hunter', weight: 'high', category: 'stats' },
    { key: 'garbage_time', labelKey: 'reasons.stat_padder.garbage_time', weight: 'normal', category: 'stats' },
    { key: 'walking_defense', labelKey: 'reasons.stat_padder.walking_defense', weight: 'normal', category: 'controversy' },
    { key: 'ball_dominant', labelKey: 'reasons.stat_padder.ball_dominant', weight: 'normal', category: 'narrative' },
    { key: 'stats_over_wins', labelKey: 'reasons.stat_padder.stats_over_wins', weight: 'high', category: 'narrative' },
    { key: 'usage_rate_historian', labelKey: 'reasons.stat_padder.usage_rate_historian', weight: 'normal', category: 'stats' },
    { key: 'transition_cherry_picker', labelKey: 'reasons.stat_padder.transition_cherry_picker', weight: 'normal', category: 'narrative' },
    { key: 'selective_shot_taking', labelKey: 'reasons.stat_padder.selective_shot_taking', weight: 'normal', category: 'stats' },
  ],
}
