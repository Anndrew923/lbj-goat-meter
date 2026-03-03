import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * AnalystGate — 進階情報閘門與冷卻控制
 *
 * - 視覺上：未授權時將子內容模糊 + 鎖定互動，顯示「看完激勵式廣告後解鎖」卡片。
 * - 風控上：冷卻改由後端 Reads 優化與 Hook 節流處理，前端不再限制點擊次數。
 * - 實作策略：
 *   - 所有 Reads 優化交由 useSentimentData 的 debounce + Session Cache 處理。
 *   - 本組件只負責顯示玻璃擬態閘門與觸發「觀看廣告解鎖」行為。
 */

export default function AnalystGate({
  authorized,
  onRequestRewardAd,
  gateTitle,
  gateDescription,
  gateButtonText,
  children,
}) {
  const { t } = useTranslation("common");

  const handleRequestAccess = useCallback(() => {
    if (!onRequestRewardAd) return;

    onRequestRewardAd();
  }, [onRequestRewardAd]);

  // 已授權：直接顯示子內容，不再顯示閘門
  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-md brightness-75">
        {children}
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-2xl">
        <div className="relative max-w-md w-full mx-4 rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-transparent px-6 py-7 shadow-[0_0_40px_rgba(160,32,240,0.35)]">
          {/* 掃描條：增加「資料運算中」的科技感 */}
          <div className="pointer-events-none absolute inset-x-6 -inset-y-4 overflow-hidden">
            <div className="absolute inset-x-0 h-24 -top-12 bg-gradient-to-b from-transparent via-machine-silver/40 to-transparent rounded-full blur-md animate-gate-scan" />
          </div>

          {gateTitle && (
            <h3 className="text-lg font-bold text-king-gold mb-2 text-center">
              {gateTitle}
            </h3>
          )}
          {gateDescription && (
            <p className="text-sm text-gray-300 mb-4 text-center">
              {gateDescription}
            </p>
          )}

          <button
            type="button"
            onClick={handleRequestAccess}
            className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-king-gold text-black font-semibold text-sm hover:bg-king-gold/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-king-gold/70"
          >
            {gateButtonText || t("unlock30Energy")}
          </button>
          <p className="mt-3 text-[11px] text-gray-400 text-center">
            {t("analystGateAdDisclaimer")}
          </p>
          <p className="text-[10px] text-machine-silver/50 mt-2 text-center">
            {t("analystGateExpiryDisclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}

