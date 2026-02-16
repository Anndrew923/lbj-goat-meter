/**
 * BattleCardContainer — 戰報卡容器：數據邏輯、主題計算
 * 使用 createPortal 將 Modal 渲染至 document.body，避免被父層 overflow 裁切。
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { TEAMS, TEAM_COLORS, BATTLE_CARD_DEFAULT_COLORS } from '../lib/constants'
import { getStanceDisplay } from '../i18n/i18n'
import { calculateBattleTitle } from '../utils/battleCardUtils'
import BattleCard from './BattleCard'

function getTeamLabel(voterTeam, t) {
  const team = TEAMS.find((x) => x.value === voterTeam)
  if (team && t) return t(`team_${voterTeam}`) || team.label
  return team?.label ?? voterTeam ?? '—'
}

export default function BattleCardContainer({
  open,
  onClose,
  onRevote,
  revoking = false,
  revoteError,
  onRevoteReload,
  photoURL,
  displayName,
  voterTeam,
  status,
  reasonLabels = [],
  city = '',
  country = '',
  rankLabel,
  exit = { opacity: 0, scale: 0.9 },
  /** 喚起激勵廣告（或模擬廣告），播放完畢後須呼叫 onWatched()；未傳則點擊下載不執行 toPng。 */
  onRequestRewardAd,
}) {
  const { t, i18n } = useTranslation('common')
  const [warzoneStats, setWarzoneStats] = useState(null)
  /** 下載權限：預覽頁進入時為 false，看完激勵影片後為 true，解鎖 640×640 高清下載 */
  const [isExportReady, setIsExportReady] = useState(false)

  const teamLabel = useMemo(() => getTeamLabel(voterTeam, t), [voterTeam, t])

  /** 每次打開預覽時重置下載權限，確保需看完廣告才可下載高清圖 */
  useEffect(() => {
    if (open) setIsExportReady(false)
  }, [open])

  const onExportUnlock = useCallback(() => setIsExportReady(true), [])

  useEffect(() => {
    if (!open || !voterTeam || !db) return
    const warzoneId = String(voterTeam).trim()
    if (!warzoneId) return
    let cancelled = false
    getDoc(doc(db, 'warzoneStats', warzoneId))
      .then((snap) => {
        if (cancelled) return
        setWarzoneStats(snap.exists() ? snap.data() : null)
      })
      .catch(() => {
        if (!cancelled) setWarzoneStats(null)
      })
    return () => { cancelled = true }
  }, [open, voterTeam])

  const teamColors = useMemo(() => {
    if (!voterTeam) return BATTLE_CARD_DEFAULT_COLORS
    return TEAM_COLORS[voterTeam] ?? BATTLE_CARD_DEFAULT_COLORS
  }, [voterTeam])

  const battleTitleResult = useMemo(
    () => calculateBattleTitle(status, warzoneStats, teamLabel),
    [status, warzoneStats, teamLabel],
  )

  const titleText = useMemo(() => {
    if (battleTitleResult.kind === 'default') {
      const locale = i18n.language?.startsWith('zh') ? 'zh' : 'en'
      const stanceLabel = getStanceDisplay(status, locale)
      return t('battleCard.stance_default', { stance: stanceLabel })
    }
    return t(battleTitleResult.titleKey)
  }, [battleTitleResult, status, t, i18n.language])

  const subtitleText = useMemo(
    () => t(battleTitleResult.subtitleKey, battleTitleResult.subtitleParams),
    [battleTitleResult, t],
  )

  const battleCard = open ? (
    <BattleCard
      open={open}
      onClose={onClose}
      onRevote={onRevote}
      revoking={revoking}
      revoteError={revoteError}
      onRevoteReload={onRevoteReload}
      photoURL={photoURL}
      displayName={displayName}
      voterTeam={voterTeam}
      teamLabel={teamLabel}
      status={status}
      reasonLabels={reasonLabels}
      city={city}
      country={country}
      rankLabel={rankLabel}
      exit={exit}
      teamColors={teamColors}
      battleTitle={titleText}
      battleSubtitle={subtitleText}
      warzoneStats={warzoneStats}
      isTitleUppercase={i18n.language?.startsWith('en')}
      isExportReady={isExportReady}
      onExportUnlock={onExportUnlock}
      onRequestRewardAd={onRequestRewardAd}
    />
  ) : null

  if (typeof document === 'undefined') return battleCard
  return createPortal(battleCard, document.body)
}
