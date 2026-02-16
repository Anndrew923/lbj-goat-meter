/**
 * AnalystGate — 金流／情報權限閘口（分析師通行證）
 *
 * - 金流模式（預設）：authorized 未傳時以 currentUser.isPremium 判斷；解鎖 CTA 為「模擬購買」。
 * - 情報模式：傳入 authorized、onRequestRewardAd 與 gateTitle/gateDescription/gateButtonText，
 *    用於「篩選/數據分析」區塊的偵查授權，解鎖按鈕觸發激勵廣告。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { Lock, Loader2 } from "lucide-react";
import { simulatePurchase } from "../services/PaymentService";

export default function AnalystGate({
  children,
  /** 情報模式：顯式授權狀態（未傳則以 isPremium 判斷） */
  authorized,
  /** 情報模式：解鎖按鈕觸發激勵廣告 */
  onRequestRewardAd,
  /** 情報模式：覆蓋標題 */
  gateTitle,
  /** 情報模式：覆蓋描述 */
  gateDescription,
  /** 情報模式：覆蓋按鈕文案 */
  gateButtonText,
}) {
  const { t } = useTranslation("common");
  const { currentUser, refreshEntitlements } = useAuth();
  const [purchasing, setPurchasing] = useState(false);

  const isIntelMode =
    typeof authorized === "boolean" &&
    (onRequestRewardAd != null || gateTitle != null);
  const isUnlocked = isIntelMode
    ? authorized === true
    : currentUser?.isPremium === true;

  const handleSimulatePurchase = async () => {
    if (!currentUser?.uid || purchasing) return;
    setPurchasing(true);
    try {
      await simulatePurchase(currentUser.uid);
      await refreshEntitlements();
    } catch (err) {
      console.error("[AnalystGate] simulatePurchase failed", err);
    } finally {
      setPurchasing(false);
    }
  };

  const handleUnlockClick = () => {
    if (isIntelMode && onRequestRewardAd) {
      onRequestRewardAd(() => {});
    } else {
      handleSimulatePurchase();
    }
  };

  const title = gateTitle ?? t("unlockAnalystTitle");
  const description = gateDescription ?? t("unlockAnalystDesc");
  const buttonLabel = gateButtonText ?? t("simulatePurchase");
  const useAdButton = isIntelMode && onRequestRewardAd;

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div
        className="pointer-events-none select-none blur-sm opacity-60"
        aria-hidden="true"
      >
        {children}
      </div>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-villain-purple/50 bg-black/90 p-8 text-center"
        role="region"
        aria-label={t("analystGateAria")}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-sm"
        >
          <div className="inline-flex rounded-full bg-villain-purple/30 p-4 mb-4">
            <Lock className="w-10 h-10 text-villain-purple" aria-hidden />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
          <p className="text-sm text-gray-400 mb-6">{description}</p>
          <motion.button
            type="button"
            onClick={handleUnlockClick}
            disabled={!useAdButton && purchasing}
            whileHover={
              (!useAdButton && !purchasing) || useAdButton
                ? { scale: 1.03 }
                : {}
            }
            whileTap={
              (!useAdButton && !purchasing) || useAdButton
                ? { scale: 0.98 }
                : {}
            }
            className="px-6 py-3 rounded-lg bg-king-gold text-black font-semibold disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mx-auto"
          >
            {!useAdButton && purchasing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
                {t("paymentProcessing")}
              </>
            ) : (
              buttonLabel
            )}
          </motion.button>
          {!isIntelMode && (
            <p className="mt-3 text-xs text-gray-500">{t("sandboxNote")}</p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
