/**
 * LiveTicker — 即時戰報跑馬燈（無縫無限滾動）
 * 數據來自 WarzoneDataContext（global_summary.recentVotes），嚴禁掃描 votes 集合。
 * - 無限跑馬燈：CSS keyframes + transform: translateX（GPU 加速）
 * - 互動：pauseOnHover / pauseOnClick
 */
import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWarzoneData } from '../context/WarzoneDataContext'
import { getTeamCityKey } from '../lib/lbjConstants'
import { getStanceDisplayTicker } from '../i18n/i18n'

function getTeamFanLabel(voterTeam, t) {
  if (!voterTeam) return t('someFan')
  const label = t(getTeamCityKey(voterTeam))
  return `${label}${t('fanSuffix')}`
}

function getStanceDisplay(status) {
  const label = getStanceDisplayTicker(status)
  if (label != null && label !== '') return label
  return status != null ? String(status) : '—'
}

function formatTimeAgo(createdAt, t) {
  if (!createdAt?.toMillis) return t('justNow')
  const sec = Math.floor((Date.now() - createdAt.toMillis()) / 1000)
  if (sec < 60) return t('secondsAgo', { count: sec })
  if (sec < 3600) return t('minutesAgo', { count: Math.floor(sec / 60) })
  return t('earlier')
}

function TickerItem({ vote, t }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-gray-300 whitespace-nowrap font-secondary font-semibold"
      style={{ flexShrink: 0 }}
    >
      {formatTimeAgo(vote.createdAt, t)}{t('tickerFrom')}
      <strong className="text-king-gold mx-1">{vote.city || vote.country || t('unknown')}</strong>
      {t('tickerOf')}
      <strong className="text-villain-purple/90 mx-1">{getTeamFanLabel(vote.voterTeam, t)}</strong>
      {t('tickerVoted')}
      <strong className="text-king-gold mx-1">{getStanceDisplay(vote.status)}</strong>{t('tickerExclamation')}
    </span>
  )
}

export default function LiveTicker({ forcePaused = false }) {
  const { t } = useTranslation('common')
  const { recentVotes } = useWarzoneData()
  const [pausedByClick, setPausedByClick] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  const items = useMemo(
    () => (recentVotes ?? []).map((v, i) => ({ id: `recent-${i}`, ...v })),
    [recentVotes]
  )

  /** 開發環境無資料時用 placeholder，確保跑馬燈有內容可測、動畫可見 */
  const effectiveItems = useMemo(() => {
    if (items.length > 0) return items
    if (import.meta.env.DEV) {
      return [
        { id: 'placeholder-1', city: 'Demo', status: 'goat', voterTeam: 'LAL' },
        { id: 'placeholder-2', city: 'Local', status: 'king', voterTeam: null },
      ]
    }
    return []
  }, [items])

  /** 無縫跑馬燈：同一組內容渲染兩遍，translateX(-50%) 時視覺等同起點 */
  const duplicatedItems = useMemo(
    () => (effectiveItems.length > 0 ? [...effectiveItems, ...effectiveItems] : []),
    [effectiveItems]
  )

  const togglePause = useCallback(() => {
    setPausedByClick((p) => !p)
  }, [])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        togglePause()
      }
    },
    [togglePause]
  )

  if (effectiveItems.length === 0) return null

  /** 點擊暫停、懸停暫停、或戰報導出中：單一來源控制 animation-play-state（避免 inline 覆蓋 hover） */
  const isPaused = pausedByClick || isHovering || forcePaused

  return (
    <div
      className="border-b border-villain-purple/30 bg-gray-950/90 overflow-hidden py-2"
      role="region"
      aria-label={t('liveTicker')}
    >
      <div className="flex items-center gap-2 px-4 h-full min-h-[2.25rem]">
        {/* 標題固定左側，不參與跑動 */}
        <div className="flex items-center gap-2 text-king-gold text-sm font-semibold font-secondary shrink-0" aria-hidden>
          <span>🔥</span>
          <span>{t('liveTicker')}</span>
        </div>
        {/* 右側戰報內容區：跑馬燈 + 懸停/點擊暫停；尊重 prefers-reduced-motion */}
        <div
          className="flex-1 min-w-0 overflow-hidden flex items-center cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-king-gold focus-visible:ring-inset"
          onClick={togglePause}
          onKeyDown={handleKeyDown}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          role="button"
          tabIndex={0}
          aria-label={isPaused ? t('tickerResume') : t('tickerPause')}
          title={isPaused ? t('tickerResume') : t('tickerPause')}
        >
          <div
            className="flex items-center gap-6 pl-4 will-change-[transform] animate-marquee motion-reduce:animate-none"
            style={{
              animationPlayState: isPaused ? 'paused' : 'running',
              width: 'max-content',
            }}
            data-live-ticker="marquee"
          >
            {duplicatedItems.map((vote, idx) => (
              <TickerItem key={`marquee-${idx}`} vote={vote} t={t} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
