/**
 * AnalystGate — 金流權限閘口（分析師通行證）
 *
 * 設計意圖：與業務邏輯完全解耦的權限層。
 * - 當 currentUser.isPremium 為 false 時，遮蔽子內容並顯示「解鎖全球精細化分析報告」的 CTA。
 * - 「模擬購買」呼叫 PaymentService.simulatePurchase，經 2 秒後以 Transaction 更新 Firestore profiles.isPremium，
 *    再透過 refreshEntitlements 同步至 Context，閘口開啟。
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { Lock, Loader2 } from 'lucide-react'
import { simulatePurchase } from '../services/PaymentService'

export default function AnalystGate({ children }) {
  const { currentUser, refreshEntitlements } = useAuth()
  const [purchasing, setPurchasing] = useState(false)

  const isUnlocked = currentUser?.isPremium === true

  const handleSimulatePurchase = async () => {
    if (!currentUser?.uid || purchasing) return
    setPurchasing(true)
    try {
      await simulatePurchase(currentUser.uid)
      await refreshEntitlements()
    } catch (err) {
      console.error('[AnalystGate] simulatePurchase failed', err)
    } finally {
      setPurchasing(false)
    }
  }

  if (isUnlocked) {
    return <>{children}</>
  }

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm opacity-60" aria-hidden="true">
        {children}
      </div>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-villain-purple/50 bg-black/90 p-8 text-center"
        role="region"
        aria-label="分析師通行證解鎖區"
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-sm"
        >
          <div className="inline-flex rounded-full bg-villain-purple/30 p-4 mb-4">
            <Lock className="w-10 h-10 text-villain-purple" aria-hidden />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">解鎖全球精細化分析報告</h3>
          <p className="text-sm text-gray-400 mb-6">
            取得分析師通行證，查看依國家、球隊、年齡拆分的深度數據與趨勢。
          </p>
          <motion.button
            type="button"
            onClick={handleSimulatePurchase}
            disabled={purchasing}
            whileHover={!purchasing ? { scale: 1.03 } : {}}
            whileTap={!purchasing ? { scale: 0.98 } : {}}
            className="px-6 py-3 rounded-lg bg-king-gold text-black font-semibold disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mx-auto"
          >
            {purchasing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
                支付處理中…
              </>
            ) : (
              '模擬購買'
            )}
          </motion.button>
          <p className="mt-3 text-xs text-gray-500">（沙盒：寫入 Firestore isPremium，正式版串接 RevenueCat）</p>
        </motion.div>
      </div>
    </div>
  )
}
