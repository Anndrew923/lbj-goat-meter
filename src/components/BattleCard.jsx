/**
 * BattleCard — 戰力分享卡片（投票完成後彈出）
 * 顯示頭像、派系、GOAT 宣言、地區排名；支援 html-to-image 下載戰報。
 */
import { useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toPng } from 'html-to-image'
import { Download } from 'lucide-react'
import { TEAMS, STANCES } from '../lib/constants'

function getTeamLabel(voterTeam) {
  return TEAMS.find((t) => t.value === voterTeam)?.label ?? voterTeam ?? '—'
}

function getStanceLabel(status) {
  return STANCES.find((s) => s.value === status)?.label ?? status ?? '—'
}

export default function BattleCard({
  open,
  onClose,
  photoURL,
  displayName,
  voterTeam,
  status,
  reasonLabels = [],
  city = '',
  country = '',
  rankLabel = '專屬戰報',
}) {
  const cardRef = useRef(null)

  const teamLabel = getTeamLabel(voterTeam)
  const stanceLabel = getStanceLabel(status)
  const regionText = [country, city].filter(Boolean).join(' · ') || '全球'

  const handleDownload = useCallback(() => {
    if (!cardRef.current) return
    toPng(cardRef.current, {
      backgroundColor: '#0a0a0a',
      pixelRatio: 2,
      cacheBust: true,
    })
      .then((dataUrl) => {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `GOAT-Meter-${stanceLabel}-${Date.now()}.png`
        a.click()
      })
      .catch((err) => console.error('[BattleCard] toPng failed', err))
  }, [stanceLabel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="battle-card-title"
      onClick={() => onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={cardRef}
          className="rounded-2xl border-2 border-king-gold/50 bg-gradient-to-b from-gray-900 to-black p-6 shadow-xl"
          style={{ boxShadow: '0 0 40px rgba(212,175,55,0.15), inset 0 1px 0 rgba(212,175,55,0.1)' }}
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-king-gold/50 bg-gray-800 flex-shrink-0">
              {photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl text-king-gold/70">?</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-bold truncate">{displayName || '匿名戰士'}</p>
              <p className="text-king-gold text-sm">{teamLabel} · {stanceLabel}陣營</p>
            </div>
          </div>
          <div className="border-t border-villain-purple/30 pt-4 mb-4">
            <p id="battle-card-title" className="text-xs text-gray-500 uppercase tracking-wider mb-1">GOAT 宣言</p>
            <p className="text-king-gold font-semibold">{stanceLabel}</p>
            {reasonLabels.length > 0 && (
              <p className="text-sm text-gray-400 mt-1">{reasonLabels.join('、')}</p>
            )}
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-villain-purple/90">{regionText}</span>
            <span className="text-king-gold font-medium">{rankLabel}</span>
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-king-gold text-black font-bold"
          >
            <Download className="w-5 h-5" aria-hidden />
            下載戰報
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-xl border border-villain-purple/50 text-gray-300 hover:text-white"
          >
            關閉
          </button>
        </div>
      </motion.div>
    </div>
  )
}
