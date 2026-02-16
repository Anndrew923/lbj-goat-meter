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

/** 投票戰場：六大立場對抗版（對應 votes.status）；視覺意圖：金／紫／皇冠紅／石墨灰／科技銀／鐵鏽銅 */
export const STANCES = [
  { value: 'goat', theme: 'king-gold' },
  { value: 'fraud', theme: 'villain-purple' },
  { value: 'king', theme: 'crown-red' },
  { value: 'mercenary', theme: 'graphite' },
  { value: 'machine', theme: 'machine-silver' },
  { value: 'stat_padder', theme: 'rust-copper' },
]

/** 立場 → 主題色（hex），供 StanceCards / 雷達圖藥丸與描邊聯動 */
export const STANCE_COLORS = {
  goat: '#D4AF37',
  fraud: '#4B0082',
  king: '#B42832',
  mercenary: '#3C3C41',
  machine: '#C0C0C8',
  stat_padder: '#B87333',
}

/** 依立場動態顯示的原因標籤（用於標籤雲）；value 為寫入 votes.reasons 的代碼；對抗版佔位以維持流程 */
export const REASONS_BY_STANCE = {
  goat: [
    { value: '411', label: '411 工程' },
    { value: 'longevity', label: '長青' },
    { value: 'iq', label: '球商' },
  ],
  fraud: [
    { value: 'narrative', label: '爭議敘事' },
    { value: 'overrated', label: '過譽' },
  ],
  king: [
    { value: 'leadership', label: '領袖' },
    { value: 'legacy', label: '傳承' },
  ],
  mercenary: [
    { value: 'superteam', label: '抱團' },
    { value: 'business', label: '利益取向' },
  ],
  machine: [
    { value: 'consistency', label: '穩定' },
    { value: 'durability', label: '耐戰' },
  ],
  stat_padder: [
    { value: 'numbers', label: '數據' },
    { value: 'empty_stats', label: '刷數據' },
  ],
}
