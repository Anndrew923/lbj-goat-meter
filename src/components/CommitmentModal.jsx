/**
 * CommitmentModal — 突發戰區投票前戰術確認
 *
 * 設計意圖：投票不可撤回，點選選項後先彈出此 Modal 顯示文案與所選選項（Highlight），
 * 使用者點「確認投下」後才執行 submitBreakingVote；取消則關閉不送票。
 * 視覺：暗黑競技風 + 細微紅色警告邊框。
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence } from 'framer-motion'
import ModalShell from './ModalShell'

export default function CommitmentModal({
  open,
  onClose,
  onConfirm,
  optionLabel,
  loading = false,
  needsAd = false,
}) {
  const { t } = useTranslation('common')

  useEffect(() => {
    if (!open || loading) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, loading, onClose])

  return (
    <AnimatePresence initial={false}>
      {open && (
        <ModalShell
          key="commitment-modal"
          rootClassName="fixed inset-0 z-50 overflow-y-auto"
          backdropClassName="bg-black/90"
          panelClassName="w-full max-w-sm rounded-xl border-2 border-red-500/40 bg-gray-900 shadow-xl shadow-red-950/20"
          panelMotionProps={{
            initial: { opacity: 0, scale: 0.96 },
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0, scale: 0.96 },
            transition: { type: 'spring', damping: 26, stiffness: 300 },
            onClick: (e) => e.stopPropagation(),
          }}
          onBackdropClick={() => {
            if (!loading) onClose()
          }}
          rootMotionProps={{
            transition: { duration: 0.15 },
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': 'commitment-modal-title',
            'aria-describedby': 'commitment-modal-desc',
          }}
        >
            <div className="p-5">
              <h2
                id="commitment-modal-title"
                className="text-sm font-semibold text-king-gold mb-3"
              >
                {t('breakingTitle')}
              </h2>
              <p
                id="commitment-modal-desc"
                className="text-sm text-gray-300 mb-4 leading-relaxed"
              >
                {t('breakingCommitmentMessage')}
              </p>
              {needsAd && (
                <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-300 mb-0.5 flex items-center gap-1">
                    <span aria-hidden="true">⚡</span>
                    <span>{t('breakingFirstVoteFreeHint')}</span>
                  </p>
                  <p className="text-xs text-amber-100/90">
                    {t('breakingAdNotice')}
                  </p>
                </div>
              )}
              {optionLabel && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-king-gold/15 border border-king-gold/40">
                  <p className="text-xs text-gray-400 mb-0.5">
                    {t('breakingEnter')}
                  </p>
                  <p className="text-king-gold font-semibold truncate">
                    {optionLabel}
                  </p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg font-semibold bg-king-gold text-black hover:bg-king-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? t('submitting') : t('breakingCommitmentConfirm')}
                </button>
              </div>
            </div>
        </ModalShell>
      )}
    </AnimatePresence>
  )
}
