/**
 * AnalystGate — 情報權限閘口（全廣告驅動）
 * 僅依 authorized 決定是否解鎖；按鈕固定為「解鎖情報」並觸發 onRequestRewardAd。
 */
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";

export default function AnalystGate({
  children,
  /** 偵查授權狀態，僅此屬性決定是否解鎖 */
  authorized,
  /** 解鎖按鈕觸發激勵廣告 */
  onRequestRewardAd,
  /** 覆蓋標題（預設 intelGateTitle） */
  gateTitle,
  /** 覆蓋描述（預設 intelGateDesc） */
  gateDescription,
  /** 覆蓋按鈕文案（預設 intelGateButton） */
  gateButtonText,
}) {
  const { t } = useTranslation("common");
  const isUnlocked = authorized === true;

  const title = gateTitle ?? t("intelGateTitle");
  const description = gateDescription ?? t("intelGateDesc");
  const buttonLabel = gateButtonText ?? t("intelGateButton");

  const handleUnlockClick = () => {
    onRequestRewardAd?.(() => {});
  };

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
            disabled={!onRequestRewardAd}
            whileHover={onRequestRewardAd ? { scale: 1.03 } : undefined}
            whileTap={onRequestRewardAd ? { scale: 0.98 } : undefined}
            className="px-6 py-3 rounded-lg bg-king-gold text-black font-semibold flex items-center justify-center gap-2 mx-auto disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {buttonLabel}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}
