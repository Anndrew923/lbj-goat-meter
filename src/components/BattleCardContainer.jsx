/**
 * BattleCardContainer — 戰報卡容器：數據邏輯、主題計算
 * 使用 createPortal 將 Modal 渲染至 document.body，避免被父層 overflow 裁切。
 * 解鎖後可將戰報存檔至終端硬碟（相簿 GOAT_Warzone）。
 */
import { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { doc, getDoc } from 'firebase/firestore'
import { toPng } from 'html-to-image'
import { Capacitor } from '@capacitor/core'
import { Media } from '@capacitor-community/media'
import { db } from '../lib/firebase'
import { TEAMS, TEAM_COLORS, BATTLE_CARD_DEFAULT_COLORS } from '../lib/constants'
import { getStanceDisplay } from '../i18n/i18n'
import { calculateBattleTitle } from '../utils/battleCardUtils'
import BattleCard from './BattleCard'

const CARD_SIZE = 640
const GOAT_ALBUM_NAME = 'GOAT_Warzone'

function getTeamLabel(voterTeam, t) {
  const team = TEAMS.find((x) => x.value === voterTeam)
  if (team && t) return t(`team_${voterTeam}`) || team.label
  return team?.label ?? voterTeam ?? '—'
}

/** 取得或建立 GOAT_Warzone 相簿並回傳 identifier（原生端用）。Android 新建相簿後 getAlbums 可能延遲，故重試一次。 */
async function ensureGoatAlbumIdentifier() {
  const list = (await Media.getAlbums())?.albums ?? []
  let album = list.find((a) => a.name === GOAT_ALBUM_NAME)
  if (!album) {
    await Media.createAlbum({ name: GOAT_ALBUM_NAME })
    await new Promise((r) => setTimeout(r, 350))
    const list2 = (await Media.getAlbums())?.albums ?? []
    album = list2.find((a) => a.name === GOAT_ALBUM_NAME)
  }
  return album?.identifier
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

  const teamLabel = useMemo(() => getTeamLabel(voterTeam, t), [voterTeam, t])

  /** 每次打開預覽時重置下載權限，確保需看完廣告才可下載高清圖 */
  useEffect(() => {
    if (open) setIsExportReady(false)
  }, [open])

  const onExportUnlock = useCallback(() => setIsExportReady(true), [])

  /**
   * 將戰報卡（battle-card-ref）轉 PNG 並存至終端硬碟（原生：GOAT_Warzone 相簿；Web：下載）。
   * 供解鎖後「下載高解析戰報」按鈕與廣告結束後詢問存檔使用。
   */
  const handleDownload = useCallback(async () => {
    const el = battleCardRef.current
    if (!el) return
    onExportStart?.()
    const prev = {
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
      left: el.style.left,
      top: el.style.top,
      margin: el.style.margin,
      padding: el.style.padding,
    }
    el.style.transform = 'scale(1)'
    el.style.transformOrigin = 'top left'
    el.style.left = '0'
    el.style.top = '0'
    el.style.margin = '0'
    el.style.padding = '0'
    try {
      const dataUrl = await toPng(el, {
        width: CARD_SIZE,
        height: CARD_SIZE,
        backgroundColor: '#0a0a0a',
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true, // 避免讀取跨域 CSS（如 Google Fonts）觸發 SecurityError
      })
      if (Capacitor.isNativePlatform()) {
        const albumIdentifier = await ensureGoatAlbumIdentifier()
        await Media.savePhoto({
          path: dataUrl,
          albumIdentifier: albumIdentifier ?? undefined,
          fileName: `GOAT-Meter-${Date.now()}`,
        })
      } else {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `GOAT-Meter-${Date.now()}.png`
        a.click()
      }
    } catch (err) {
      console.error('[BattleCardContainer] save report failed', err)
    } finally {
      el.style.transform = prev.transform
      el.style.transformOrigin = prev.transformOrigin
      el.style.left = prev.left
      el.style.top = prev.top
      el.style.margin = prev.margin
      el.style.padding = prev.padding
      onExportEnd?.()
    }
  }, [onExportStart, onExportEnd])

  useImperativeHandle(ref, () => ({ saveToGallery: handleDownload }), [handleDownload])

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
      onSaveToGallery={handleDownload}
      onExportStart={onExportStart}
      onExportEnd={onExportEnd}
    />
  ) : null

  if (typeof document === 'undefined') return battleCard
  return createPortal(battleCard, document.body)
})

export default BattleCardContainer
