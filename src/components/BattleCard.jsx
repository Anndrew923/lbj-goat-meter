/**
 * BattleCard — 戰力分享卡片（投票完成後彈出）
 * 顯示頭像、派系、GOAT 宣言、地區排名；支援 html-to-image 下載戰報。
 * 重置按鈕：磨砂玻璃感，點擊後由父層執行 Transaction 撤銷投票，本卡以 exit 動畫「粒子化崩解」後卸載。
 */
import { useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toPng } from 'html-to-image'
import { Download, RotateCcw } from 'lucide-react'
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
  rankLabel = '專屬戰報',
  exit = { opacity: 0, scale: 0.9 },
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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="battle-card-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={exit}
      transition={{ duration: 0.25 }}
      onClick={() => onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm flex flex-col items-center"
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

        <div className="flex gap-3 mt-4 w-full">
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

        {/* 磨砂玻璃感重置按鈕：立場重塑，非生硬切換 */}
        {onRevote && (
          <motion.button
            type="button"
            onClick={onRevote}
            disabled={revoking}
            className="mt-4 w-full max-w-sm py-3 px-4 rounded-xl font-medium text-sm text-king-gold/95 bg-white/10 backdrop-blur-md border border-king-gold/30 hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            whileHover={!revoking ? { scale: 1.02 } : {}}
            whileTap={!revoking ? { scale: 0.98 } : {}}
          >
            <RotateCcw className="w-4 h-4" aria-hidden />
            {revoking ? '重置中…' : '重置立場'}
          </motion.button>
        )}
        {revoteError && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-red-400" role="alert">
              {revoteError}
            </p>
            {onRevoteReload && (
              <button
                type="button"
                onClick={onRevoteReload}
                className="py-2 px-3 rounded-lg text-sm font-medium bg-king-gold/20 text-king-gold border border-king-gold/40 hover:bg-king-gold/30"
              >
                重新整理頁面
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
