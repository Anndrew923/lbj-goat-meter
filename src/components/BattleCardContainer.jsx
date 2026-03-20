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

    // 强制双重 rAF（style 变更之后）
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    // 强制重排/刷新（黑科技）
    void el.offsetHeight

    // 若有外部圖片（photoURL），尽可能等 decode/载入完成
    const imgs = Array.from(el.querySelectorAll('img'))
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise((res) => {
            const t = window.setTimeout(res, 450)
            try {
              if (typeof img.decode === 'function') {
                img.decode().finally(() => {
                  window.clearTimeout(t)
                  res(true)
                })
                return
              }
              if (img.complete) {
                window.clearTimeout(t)
                res(true)
                return
              }
              img.onload = () => {
                window.clearTimeout(t)
                res(true)
              }
              img.onerror = () => {
                window.clearTimeout(t)
                res(true)
              }
            } catch {
              window.clearTimeout(t)
              res(true)
            }
          }),
      ),
    )
    // 强制把关键视觉样式重新写回 inline，避免 html-to-image clone 使用到旧 computed snapshot
    const computed = window.getComputedStyle(el)
    el.style.backgroundImage = computed.backgroundImage
    el.style.backgroundColor = computed.backgroundColor
    el.style.backgroundSize = computed.backgroundSize
    el.style.backgroundPosition = computed.backgroundPosition
    el.style.backgroundRepeat = computed.backgroundRepeat
    el.style.filter = computed.filter
    el.style.boxShadow = computed.boxShadow

    // Phase 8：强制同步子層（laser-cut / reflective-sweeps），避免 html-to-image clone 使用到旧樣式快照
    const laserEl = el.querySelector('[data-export-role="laser-cut"]')
    if (laserEl) {
      const laserCs = window.getComputedStyle(laserEl)
      laserEl.style.backgroundImage = laserCs.backgroundImage
      laserEl.style.mixBlendMode = laserCs.mixBlendMode
      laserEl.style.opacity = laserCs.opacity
      laserEl.style.filter = laserCs.filter
    }
    const reflectEl = el.querySelector('[data-export-role="reflective-sweeps"]')
    if (reflectEl) {
      const reflectCs = window.getComputedStyle(reflectEl)
      reflectEl.style.backgroundImage = reflectCs.backgroundImage
      reflectEl.style.mixBlendMode = reflectCs.mixBlendMode
      reflectEl.style.opacity = reflectCs.opacity
      reflectEl.style.filter = reflectCs.filter
      reflectEl.style.top = reflectCs.top
      reflectEl.style.height = reflectCs.height
    }

    const exportTag =
      typeof computed.backgroundImage === 'string' && computed.backgroundImage.includes('115deg')
        ? 'PH8'
        : 'LEGACY'

    const toPngBaseOpts = {
      width: CARD_SIZE,
      height: CARD_SIZE,
      // Phase 5：統一使用較深的暗部基底，避免壓暗不足導致金屬高光黯淡
      backgroundColor: '#050505',
      pixelRatio: 2,
      cacheBust: true,
      skipFonts: true, // 避免讀取跨域 CSS（如 Google Fonts）觸發 SecurityError
    }

    try {
      let dataUrl = await toPng(el, toPngBaseOpts)

      if (Capacitor.isNativePlatform()) {
        const albumIdentifier = await ensureGoatAlbumIdentifier()
        await Media.savePhoto({
          path: dataUrl,
          albumIdentifier: albumIdentifier ?? undefined,
          fileName: `GOAT-Meter-${exportTag}-${Date.now()}`,
        })
      } else {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `GOAT-Meter-${exportTag}-${Date.now()}.png`
        a.click()
      }
    } catch (err) {
      console.warn('[BattleCardContainer] toPng failed (retry without external IMG)', err)
      try {
        const dataUrl = await toPng(el, {
          ...toPngBaseOpts,
          filter: (node) => {
            if (node && node.nodeName === 'IMG') {
              const src =
                node.getAttribute('src') || node.currentSrc || node.src || ''
              if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
                return false
              }
            }
            return true
          },
        })

        if (Capacitor.isNativePlatform()) {
          const albumIdentifier = await ensureGoatAlbumIdentifier()
          await Media.savePhoto({
            path: dataUrl,
            albumIdentifier: albumIdentifier ?? undefined,
            fileName: `GOAT-Meter-${exportTag}-${Date.now()}`,
          })
        } else {
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = `GOAT-Meter-${exportTag}-${Date.now()}.png`
          a.click()
        }
      } catch (err2) {
        console.error('[BattleCardContainer] save report failed after retry', err2)
      }
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
