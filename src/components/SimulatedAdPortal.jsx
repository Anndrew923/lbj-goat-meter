/**
 * SimulatedAdPortal — 模擬廣告全螢幕視窗（MVP 驗收用）
 * 深色毛玻璃、倒數 5 秒後呼叫 onWatched() 並關閉，用於觸發戰報下載解鎖。
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

const DEFAULT_DURATION = 5

/**
 * @param {boolean} [open=false] - 是否顯示模擬廣告視窗
 * @param {() => void} [onClose] - 關閉視窗時呼叫（可與 onWatched 共用邏輯）
 * @param {() => void} [onWatched] - 倒數結束後呼叫一次，由呼叫方解鎖並觸發 handleDownload(true)
 * @param {number} [duration=5] - 倒數秒數
 */
export default function SimulatedAdPortal({
  open = false,
  onClose,
  onWatched,
  duration = DEFAULT_DURATION,
}) {
  const [secondsLeft, setSecondsLeft] = useState(duration)
  const onWatchedRef = useRef(onWatched)
  const onCloseRef = useRef(onClose)
  const hasFiredRef = useRef(false)

  onWatchedRef.current = onWatched
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) {
      setSecondsLeft(duration)
      hasFiredRef.current = false
      return
    }
    hasFiredRef.current = false
    setSecondsLeft(duration)
    const tick = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(tick)
          if (!hasFiredRef.current) {
            hasFiredRef.current = true
            onWatchedRef.current?.()
            onCloseRef.current?.()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [open, duration])

  if (!open) return null

  const portal = (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label="模擬廣告"
    >
      <div className="text-center px-6 max-w-sm">
        <p className="text-white/95 text-lg font-medium">
          正在獲取戰報生成權限...
        </p>
        <p className="mt-2 text-white/60 text-sm">
          （模擬廣告中，剩餘 {secondsLeft} 秒）
        </p>
      </div>
    </motion.div>
  )

  if (typeof document === 'undefined') return portal
  return createPortal(portal, document.body)
}
