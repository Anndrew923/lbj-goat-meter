/**
 * BattleCard — 戰報卡純 UI（由 BattleCardContainer 注入數據與主題）
 * Layer 1: 動態背景 + 浮水印 + 雜訊紋理 | Layer 2: 邊框光暈 | Layer 3: 稱號、力量標題、證詞、QR、免責
 * 固定 1:1 (640×640)，scale-to-fit 縮放；640×640 高清下載需 isExportReady（廣告解鎖後自動觸發一次下載）。
 */
import { useRef, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Download, RotateCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { STANCE_COLORS } from "../lib/constants";
import { hexWithAlpha } from "../utils/colorUtils";
import { getStance } from "../i18n/i18n";

const CARD_SIZE = 640;
/** 預留給按鈕組的垂直空間（px），scale 計算時扣除此值避免卡片壓住按鈕 */
const BUTTON_GROUP_RESERVE = 200;

/** 球卡雜訊紋理用 SVG data URL（feTurbulence），重複平鋪 */
const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23fff'/%3E%3C/svg%3E";

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
  teamLabel = "—",
  status,
  reasonLabels = [],
  city = "",
  country = "",
  rankLabel,
  exit = { opacity: 0, scale: 0.9 },
  teamColors = { primary: "#D4AF37", secondary: "#8B0000" },
  battleTitle = "",
  battleSubtitle = "",
  warzoneStats = null,
  isTitleUppercase = true,
  isExportReady = false,
  onExportUnlock,
  onRequestRewardAd,
}) {
  const { t } = useTranslation("common");
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const [containerSize, setContainerSize] = useState({
    width: 600,
    height: 600,
  });
  const stanceColor = status
    ? (STANCE_COLORS[status] ?? STANCE_COLORS.goat)
    : STANCE_COLORS.goat;
  const stanceDisplayName =
    (
      getStance(status)?.primary ??
      (status ? String(status).toUpperCase() : "GOAT")
    ).toUpperCase().trim() || "GOAT";
  const stanceLen = stanceDisplayName.length;
  const powerStanceLong = stanceLen >= 11;
  const powerStanceMedium = stanceLen >= 8 && stanceLen <= 10;
  const [powerStanceLine1, powerStanceLine2] = powerStanceLong
    ? (() => {
        const idx = stanceDisplayName.indexOf(" ");
        return idx > 0
          ? [stanceDisplayName.slice(0, idx), stanceDisplayName.slice(idx + 1)]
          : [stanceDisplayName, ""];
      })()
    : [stanceDisplayName, ""];
  const regionText = [country, city].filter(Boolean).join(" · ") || t("global");
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/` : "";

  const availableHeight = Math.max(
    0,
    containerSize.height - BUTTON_GROUP_RESERVE,
  );
  const scale =
    containerSize.width > 0 && containerSize.height > 0
      ? Math.min(
          1,
          containerSize.width / CARD_SIZE,
          availableHeight / CARD_SIZE,
        )
      : 1;

  useEffect(() => {
    if (!open || !overlayRef.current) return;
    const el = overlayRef.current;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (
        typeof width === "number" &&
        typeof height === "number" &&
        width > 0 &&
        height > 0
      ) {
        setContainerSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  /** 下載戰報：僅在 isExportReady 或廣告回調傳入的 forceUnlock 時執行 640×640 toPng；未解鎖時僅喚起 onRequestRewardAd，無後門。 */
  const handleDownload = useCallback(
    (forceUnlock = false) => {
      if (!isExportReady && !forceUnlock) {
        if (onRequestRewardAd && onExportUnlock) {
          onRequestRewardAd(() => {
            onExportUnlock();
            handleDownload(true);
          });
        }
        return;
      }
      // 雙重防護：無 isExportReady 且非廣告回調的 forceUnlock 時絕不執行 toPng
      if (!isExportReady && !forceUnlock) return;
      const el = cardRef.current;
      if (!el) return;
      const prev = {
        transform: el.style.transform,
        transformOrigin: el.style.transformOrigin,
        left: el.style.left,
        top: el.style.top,
        margin: el.style.margin,
        padding: el.style.padding,
      };
      el.style.transform = "scale(1)";
      el.style.transformOrigin = "top left";
      el.style.left = "0";
      el.style.top = "0";
      el.style.margin = "0";
      el.style.padding = "0";
      // 下載品質：640×640 還原折行與動態字級，填滿畫布無黑邊；pixelRatio:2 銳利化 drop-shadow/text-shadow
      toPng(el, {
        width: CARD_SIZE,
        height: CARD_SIZE,
        backgroundColor: "#0a0a0a",
        pixelRatio: 2,
        cacheBust: true,
      })
        .then((dataUrl) => {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `GOAT-Meter-${battleTitle.replace(/\s+/g, "-")}-${Date.now()}.png`;
          a.click();
        })
        .catch((err) => console.error("[BattleCard] toPng failed", err))
        .finally(() => {
          el.style.transform = prev.transform;
          el.style.transformOrigin = prev.transformOrigin;
          el.style.left = prev.left;
          el.style.top = prev.top;
          el.style.margin = prev.margin;
          el.style.padding = prev.padding;
        });
    },
    [battleTitle, isExportReady, onExportUnlock, onRequestRewardAd],
  );

  if (!open) return null;

  const secondaryWithAlpha = hexWithAlpha(teamColors.secondary, "A0");

  return (
    <motion.div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex flex-col items-center bg-black/90 p-4 backdrop-blur-sm pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto"
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
        className="w-full max-w-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 磁吸簇：縮放後卡片 + 按鈕組同一容器，gap-y-6 緊貼 */}
        <div className="flex flex-col items-center gap-y-6">
          <div className="relative w-full flex items-center justify-center">
            <div
              style={{
                width: CARD_SIZE * scale,
                height: CARD_SIZE * scale,
              }}
              className="relative flex-shrink-0 overflow-hidden"
            >
              <div
                ref={cardRef}
                className="absolute left-1/2 top-1/2 flex flex-col bg-black text-white rounded-2xl origin-center border-2"
                style={{
                  width: CARD_SIZE,
                  height: CARD_SIZE,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  borderColor: teamColors.primary,
                  background: `linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 40%, ${secondaryWithAlpha} 100%)`,
                  boxShadow: `0 0 20px ${teamColors.primary}, 0 0 40px ${hexWithAlpha(teamColors.primary, "30")}`,
                }}
              >
                {/* Layer 1: 浮水印 */}
                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                  <div
                    className="absolute inset-0 flex flex-wrap content-start gap-x-4 gap-y-2 p-4"
                    style={{ transform: "rotate(-15deg)" }}
                    aria-hidden
                  >
                    {Array.from({ length: 40 }).map((_, i) => (
                      <span
                        key={i}
                        className="text-8xl font-black italic uppercase select-none whitespace-nowrap opacity-[0.02]"
                        style={{ color: teamColors.primary }}
                      >
                        {voterTeam || "LAL"}{" "}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Layer 1b: 球卡雜訊紋理 (analog noise, mix-blend-overlay) */}
                <div
                  className="absolute inset-0 z-0 opacity-[0.15] mix-blend-overlay pointer-events-none rounded-2xl"
                  aria-hidden
                  style={{
                    backgroundImage: `url("${NOISE_DATA_URL}")`,
                    backgroundRepeat: "repeat",
                  }}
                />

                {/* Layer 2: 邊框光暈 */}
                <div
                  className="absolute inset-0 z-10 rounded-2xl pointer-events-none border border-white/10"
                  style={{
                    boxShadow: `inset 0 0 60px rgba(0,0,0,0.3), 0 0 30px ${hexWithAlpha(teamColors.primary, "15")}`,
                  }}
                />

                {/* Layer 3: 內容（底部 pb-8 安全邊距，垂直空間回收後底部上提） */}
                <div className="relative z-20 flex flex-col flex-1 min-h-0 p-5 pb-8">
                  {/* 稱號：標題背後立場色光暈（Lens Flare） */}
                  <div className="text-center uppercase flex-shrink-0 overflow-hidden mb-3 relative">
                    <div
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      aria-hidden
                    >
                      <div
                        className="w-32 h-32 rounded-full opacity-60 blur-3xl"
                        style={{ background: stanceColor }}
                      />
                    </div>
                    <h2
                      className={`relative text-sm tracking-[0.2em] mb-1 font-semibold uppercase ${!isTitleUppercase ? "tracking-[0.1em]" : ""}`}
                      style={{ color: hexWithAlpha(stanceColor, "CC") }}
                    >
                      {battleSubtitle}
                    </h2>
                    <h1
                      id="battle-card-title"
                      className={`relative text-4xl font-black italic tracking-tighter text-white drop-shadow-lg whitespace-nowrap ${isTitleUppercase ? "uppercase" : "tracking-[0.1em]"}`}
                      style={{
                        color: stanceColor,
                        textShadow: `0 0 20px ${hexWithAlpha(stanceColor, "60")}, 0 0 40px ${hexWithAlpha(stanceColor, "30")}`,
                      }}
                    >
                      {battleTitle}
                    </h1>
                  </div>

                  {/* 身份區：城市＋代表色（去標誌化） */}
                  <div className="flex items-center gap-3 flex-shrink-0 mb-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/20 bg-white/10 flex-shrink-0">
                      {photoURL ? (
                        <img
                          src={photoURL}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xl text-white/60">
                          ?
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-bold truncate text-sm">
                        {displayName || t("anonymousWarrior")}
                      </p>
                      <p
                        className="text-sm truncate"
                        style={{ color: teamColors.primary }}
                        title={t("supporting_team", { team: teamLabel })}
                      >
                        {teamLabel
                          ? String(teamLabel).toUpperCase()
                          : t("supporting_team", { team: teamLabel })}
                      </p>
                    </div>
                  </div>

                  {/* Power Stance：折行與縮放 (1–7→120px, 8–10→95px, 11+→90px 折行) + 霓虹 + px-10 安全區；外層 rounded-2xl 與毛玻璃一致 */}
                  <div className="flex-shrink-0 relative flex items-center justify-center mt-2 mb-2 py-6 px-10 overflow-visible rounded-2xl">
                    {/* 毛玻璃襯底：-mx-4 擴張以容納 30px 霓虹光暈，rounded-2xl 柔化邊角 */}
                    <div
                      className="absolute inset-0 -z-10 -mx-4 rounded-2xl bg-black/40 backdrop-blur-xl mix-blend-multiply"
                      aria-hidden
                    />
                    <div
                      className="relative overflow-visible font-black italic uppercase tracking-tighter select-none text-center"
                      style={{
                        color: stanceColor,
                        filter: `drop-shadow(0 0 30px ${stanceColor}) drop-shadow(0 2px 3px rgba(0,0,0,1))`,
                      }}
                    >
                      {powerStanceLong ? (
                        <span className="block text-[90px] leading-[0.85]">
                          {powerStanceLine1}
                          {powerStanceLine2 ? (
                            <>
                              <br />
                              {powerStanceLine2}
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <span
                          className={
                            powerStanceMedium
                              ? "text-[95px] leading-none"
                              : "text-[120px] leading-none"
                          }
                        >
                          {powerStanceLine1}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Evidence Locker：裁決證詞區（加深背景 + 彩色文字硬邊際光） */}
                  {reasonLabels.length > 0 && (
                    <div className="flex-shrink-0 rounded-lg p-3 bg-black/50 backdrop-blur-md border border-white/10 mt-2 mb-3 max-h-[120px] overflow-y-auto overflow-x-hidden">
                      <p className="text-[10px] text-white/50 uppercase tracking-[0.2em] mb-1.5">
                        {t("battleCard.verdict_evidence")}
                      </p>
                      <p className="text-sm font-medium leading-tight">
                        {reasonLabels.map((label, i) => (
                          <span key={i}>
                            {i > 0 && " / "}
                            <span
                              style={{
                                color: stanceColor,
                                textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                              }}
                            >
                              {label}
                            </span>
                          </span>
                        ))}
                      </p>
                    </div>
                  )}

                  {/* 底部：地區 + 排名 + QR 區（上提 20px 緩解擁擠，維持安全邊距） */}
                  <div className="mt-auto -mt-5 pt-3 flex flex-wrap items-end justify-between gap-2 border-t border-white/10 px-1">
                    <div className="flex flex-col min-w-0">
                      <span
                        className="text-white/80 truncate text-xs"
                        title={regionText}
                      >
                        {regionText}
                      </span>
                      <span
                        className="text-white/70 text-xs mt-0.5"
                        title={rankLabel ?? t("rankLabel")}
                      >
                        {rankLabel ?? t("rankLabel")}
                      </span>
                    </div>
                    <div className="flex flex-row items-center gap-3 text-right flex-shrink-0 min-w-0">
                      <div className="text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/90">
                          {t("battleCard.scan_to_debate")}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/90">
                          {t("battleCard.define_history")}
                        </p>
                      </div>
                      {shareUrl && (
                        <div className="p-5 flex-shrink-0">
                          <QRCodeSVG
                            value={shareUrl}
                            size={64}
                            fgColor="white"
                            bgColor="transparent"
                            className="flex-shrink-0"
                            aria-hidden
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 免責聲明 */}
                  <p
                    className="text-[8px] text-white/40 mt-2 text-center leading-tight"
                    aria-hidden
                  >
                    {t("battleCard.disclaimer")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 按鈕組：緊貼卡片下方 (gap-y-6) */}
          <div className="flex-shrink-0 flex flex-col items-center w-full max-w-sm gap-y-4">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-king-gold text-black font-bold"
            >
              <Download className="w-5 h-5 shrink-0" aria-hidden />
              {t("downloadReport")}
            </button>

            <div className={`flex gap-3 w-full ${onRevote ? "" : "flex-col"}`}>
              {onRevote && (
                <motion.button
                  type="button"
                  onClick={onRevote}
                  disabled={revoking}
                  className="flex-1 min-w-0 py-3 px-4 rounded-xl font-medium text-sm text-king-gold/95 bg-white/10 backdrop-blur-md border border-king-gold/30 hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  whileHover={!revoking ? { scale: 1.02 } : {}}
                  whileTap={!revoking ? { scale: 0.98 } : {}}
                >
                  <RotateCcw className="w-4 h-4 shrink-0" aria-hidden />
                  {revoking ? t("resettingStance") : t("resetStance")}
                </motion.button>
              )}
              <button
                type="button"
                onClick={onClose}
                className={
                  onRevote
                    ? "px-4 py-3 rounded-xl border border-villain-purple/50 text-gray-300 hover:text-white shrink-0"
                    : "w-full py-3 rounded-xl border border-villain-purple/50 text-gray-300 hover:text-white"
                }
              >
                {t("close")}
              </button>
            </div>
            {revoteError && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-red-400" role="alert">
                  {revoteError}
                </p>
                {onRevoteReload && (
                  <button
                    type="button"
                    onClick={onRevoteReload}
                    className="py-2 px-3 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/50 hover:bg-red-500/30"
                  >
                    {t("retry")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
