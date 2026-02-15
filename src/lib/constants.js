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

/** 球隊選項：城市名稱 + 代表色暗示（voterTeam 為寫入 Firestore 用代碼） */
export const TEAMS = [
  { value: 'LAL', label: '洛杉磯', colorHint: '金／紫' },
  { value: 'GSW', label: '灣區', colorHint: '金／藍' },
  { value: 'BOS', label: '波士頓', colorHint: '綠' },
  { value: 'MIA', label: '邁阿密', colorHint: '紅／黑' },
  { value: 'CLE', label: '克里夫蘭', colorHint: '酒紅' },
  { value: 'CHI', label: '芝加哥', colorHint: '紅' },
  { value: 'NYK', label: '紐約', colorHint: '橙／藍' },
  { value: 'MIL', label: '密爾瓦基', colorHint: '綠' },
  { value: 'PHX', label: '鳳凰城', colorHint: '橙／紫' },
  { value: 'OTHER', label: '其他', colorHint: '—' },
]

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

/** 投票戰場：六大立場（對應 votes.status），暗黑競技風用 */
export const STANCES = [
  { value: 'goat', label: 'GOAT', theme: 'king-gold', description: '史上最佳' },
  { value: 'king', label: 'King', theme: 'king-gold', description: '國王' },
  { value: 'respect', label: 'Respect', theme: 'gray', description: '尊重' },
  { value: 'machine', label: 'Machine', theme: 'gray', description: '機器' },
  { value: 'decider', label: 'Decider', theme: 'villain-purple', description: '決策者' },
  { value: 'villain', label: 'Villain', theme: 'villain-purple', description: '反派' },
]

/** 依立場動態顯示的原因標籤（用於標籤雲）；value 為寫入 votes.reasons 的代碼 */
export const REASONS_BY_STANCE = {
  goat: [
    { value: '411', label: '411 工程' },
    { value: 'longevity', label: '長青' },
    { value: 'iq', label: '球商' },
    { value: 'clutch', label: '關鍵球' },
  ],
  king: [
    { value: 'leadership', label: '領袖' },
    { value: 'legacy', label: '傳承' },
    { value: 'iq', label: '球商' },
  ],
  respect: [
    { value: 'greatness', label: '偉大' },
    { value: 'competitor', label: '競爭者' },
  ],
  machine: [
    { value: 'consistency', label: '穩定' },
    { value: 'durability', label: '耐戰' },
  ],
  decider: [
    { value: 'leGM', label: 'LeGM' },
    { value: 'business', label: '商業決策' },
  ],
  villain: [
    { value: 'superteam', label: '抱團' },
    { value: 'decision', label: 'The Decision' },
    { value: 'narrative', label: '爭議敘事' },
  ],
}
