/**
 * BattleCard 稱號與戰區邏輯
 * 依用戶立場與戰區統計計算挑釁稱號（VANGUARD / LONE TRUTH / TRAITOR / 中庸）。
 */

const POSITIVE_STANCES = ['goat', 'king', 'machine']
const NEGATIVE_STANCES = ['fraud', 'mercenary', 'stat_padder']

/**
 * 計算戰區稱號
 * @param {string} userStance - 用戶立場 (goat, fraud, king, ...)
 * @param {Record<string, number>} [warzoneStats] - 戰區統計 { totalVotes, goat, fraud, ... }
 * @param {string} [teamDisplayName] - 戰區顯示名（城市或 i18n 譯文），用於副標 {{team}}
 * @returns {{ kind: string, titleKey: string, subtitleKey: string, subtitleParams: { team: string } }}
 */
export function calculateBattleTitle(userStance, warzoneStats, teamDisplayName = '') {
  const teamLabel = teamDisplayName || '—'
  const defaultResult = {
    kind: 'default',
    titleKey: 'battleCard.stance_default',
    subtitleKey: 'battleCard.stance_default_sub',
    subtitleParams: { team: teamLabel },
  }

  if (!userStance || !warzoneStats || typeof warzoneStats.totalVotes !== 'number' || warzoneStats.totalVotes <= 0) {
    return defaultResult
  }

  const userVotes = warzoneStats[userStance]
  const total = warzoneStats.totalVotes
  const userPercentage = typeof userVotes === 'number' ? (userVotes / total) * 100 : 0
  const isPositive = POSITIVE_STANCES.includes(userStance)
  const isNegative = NEGATIVE_STANCES.includes(userStance)

  // 情況 1：主流派 >= 55%
  if (userPercentage >= 55) {
    return {
      kind: 'vanguard',
      titleKey: 'battleCard.conflict_vanguard',
      subtitleKey: 'battleCard.conflict_vanguard_sub',
      subtitleParams: { team: teamLabel },
    }
  }

  // 情況 2 & 3：少數派 <= 25%
  if (userPercentage <= 25) {
    if (isPositive) {
      return {
        kind: 'lone_truth',
        titleKey: 'battleCard.conflict_lone_truth',
        subtitleKey: 'battleCard.conflict_lone_truth_sub',
        subtitleParams: { team: teamLabel },
      }
    }
    if (isNegative) {
      return {
        kind: 'traitor',
        titleKey: 'battleCard.conflict_traitor',
        subtitleKey: 'battleCard.conflict_traitor_sub',
        subtitleParams: { team: teamLabel },
      }
    }
  }

  return defaultResult
}
