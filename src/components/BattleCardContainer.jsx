/**
 * BattleCardContainer — 戰報卡容器：數據邏輯、主題計算
 * 使用 createPortal 將 Modal 渲染至 document.body，避免被父層 overflow 裁切。
 * 解鎖後可將戰報存檔至終端硬碟（相簿 GOAT_Warzone）。
 */
import { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { TEAMS, TEAM_COLORS, BATTLE_CARD_DEFAULT_COLORS } from '../lib/constants'
import { getStanceDisplay } from '../i18n/i18n'
import { calculateBattleTitle } from '../utils/battleCardUtils'
import BattleCard from './BattleCard'

/** warzoneStats 單次 getDoc 結果快取 60 秒，減少重複開啟同一戰區卡時的 Reads（Optional Optimization） */
const WARZONE_STATS_CACHE_TTL_MS = 60 * 1000
const warzoneStatsCache = new Map()

/** 回傳 { hit: true, data } 表示快取命中（data 可能為 null）；否則為快取未命中 */
function getCachedWarzoneStats(warzoneId) {
  const entry = warzoneStatsCache.get(warzoneId)
  if (!entry || typeof entry.expiresAt !== 'number') return undefined
  if (Date.now() >= entry.expiresAt) {
    warzoneStatsCache.delete(warzoneId)
    return undefined
  }
  return { hit: true, data: entry.data }
}

function setCachedWarzoneStats(warzoneId, data) {
  warzoneStatsCache.set(warzoneId, {
    data,
    expiresAt: Date.now() + WARZONE_STATS_CACHE_TTL_MS,
  })
}

function getTeamLabel(voterTeam, t) {
  const team = TEAMS.find((x) => x.value === voterTeam)
  if (team && t) return t(`team_${voterTeam}`) || team.label
  return team?.label ?? voterTeam ?? '—'
}

const BattleCardContainer = forwardRef(function BattleCardContainer(
  {
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
    /** 戰報 toPng 開始／結束時呼叫，用於暫停 LiveTicker 動畫 */
    onExportStart,
    onExportEnd,
  },
  ref,
) {
  const { t, i18n } = useTranslation('common')
  const [warzoneStats, setWarzoneStats] = useState(null)
  /** 下載權限：預覽頁進入時為 false，看完激勵影片後為 true，解鎖 640×640 高清下載／存相簿 */
  const [isExportReady, setIsExportReady] = useState(false)
  /** 戰報卡 DOM ref，供 html-to-image 抓取與 Media.savePhoto 存檔 */
  const battleCardRef = useRef(null)
  /** BattleCard 元件 imperative ref（統一匯出/抓圖路徑） */
  const battleCardComponentRef = useRef(null)

  const teamLabel = useMemo(() => getTeamLabel(voterTeam, t), [voterTeam, t])

  /** 每次打開預覽時重置下載權限，確保需看完廣告才可下載高清圖 */
  useEffect(() => {
    if (open) setIsExportReady(false)
  }, [open])

  const onExportUnlock = useCallback(() => setIsExportReady(true), [])

  /**
   * 統一匯出：BattleCard.jsx 內部單一路徑負責縮放/等待/同步/toPng/保存；
   * Container 僅做 delegation（避免雙重 handleDownload 競爭）。
   */
  const saveToGallery = useCallback(
    () => battleCardComponentRef.current?.saveToGallery?.(),
    [],
  )

  useImperativeHandle(ref, () => ({ saveToGallery }), [saveToGallery])

  useEffect(() => {
    if (!open || !voterTeam || !db) return
    const warzoneId = String(voterTeam).trim()
    if (!warzoneId) return
    let cancelled = false

    const cached = getCachedWarzoneStats(warzoneId)
    if (cached?.hit) {
      setWarzoneStats(cached.data) // data 可能為 null（文件不存在），與快取未命中區分開
      return
    }

    if (import.meta.env.DEV) {
      console.log('Firebase Fetching [BattleCardContainer] warzoneStats/' + warzoneId)
    }
    getDoc(doc(db, 'warzoneStats', warzoneId))
      .then((snap) => {
        if (cancelled) return
        const data = snap.exists() ? snap.data() : null
        setCachedWarzoneStats(warzoneId, data)
        setWarzoneStats(data)
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
      ref={battleCardComponentRef}
      cardRef={battleCardRef}
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
      onSaveToGallery={saveToGallery}
      onExportStart={onExportStart}
      onExportEnd={onExportEnd}
    />
  ) : null

  if (typeof document === 'undefined') return battleCard
  return createPortal(battleCard, document.body)
})

export default BattleCardContainer
