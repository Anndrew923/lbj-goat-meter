/**
 * SimulatedAdPortal — 模擬廣告全螢幕視窗（MVP 驗收用）
 * 深色毛玻璃、倒數 5 秒後呼叫 onWatched() 並關閉。
 * 登入頁不渲染：若目前路徑為 /login 強制 return null，避免遮罩登入流程。
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'

const DEFAULT_DURATION = 5

export default function SimulatedAdPortal({
  open = false,
  onClose,
  onWatched,
  duration = DEFAULT_DURATION,
}) {
  const location = useLocation()
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
            setTimeout(() => {
              onWatchedRef.current?.()
              onCloseRef.current?.()
            }, 0)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [open, duration])

  if (!open) return null
  if (location.pathname === '/login') return null

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
        <p className="text-white/95 text-lg font-medium">正在獲取戰報生成權限...</p>
        <p className="mt-2 text-white/60 text-sm">（模擬廣告中，剩餘 {secondsLeft} 秒）</p>
      </div>
    </motion.div>
  )

  if (typeof document === 'undefined') return portal
  return createPortal(portal, document.body)
}
