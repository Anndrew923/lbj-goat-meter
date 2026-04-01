/**
 * BattleCard — 戰報卡純 UI（由 BattleCardContainer 注入數據與主題）
 * Layer 1: 動態背景 + 浮水印 + 雜訊紋理 | Layer 2: 邊框光暈 | Layer 3: 稱號、力量標題、證詞、品牌鋼印、免責
 * 固定 1:1 (640×640)，scale-to-fit 縮放；匯出改由後端 SSR 產圖並返回下載 URL。
 * 完成後以 mirrorImg 切換為 <img>，便於行動裝置長按儲存／分享。
 * isExportReady：首次下載經廣告解鎖後由 VotingArena 觸發 saveToGallery。
 * 使用 createPortal 掛載至 document.body，脫離 VotePage 內 motion.main 的 stacking context，確保戰報卡顯示於頂部導航欄之上。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Download, RotateCcw } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Dialog } from "@capacitor/dialog";
import { Media } from "@capacitor-community/media";
import { useLocation, useNavigate } from "react-router-dom";
import { STANCE_COLORS } from "../lib/constants";
import crownIcon from "../assets/goat-crown-icon.png";
import { hexWithAlpha } from "../utils/colorUtils";
import { mixHex, hashStringToSeed, mulberry32, hexToRgb, rgbToHex } from "../utils/battleCardVisualMath";
import { getStance } from "../i18n/i18n";
import { triggerHapticPattern } from "../utils/hapticUtils";
import { buildWallWordSpecs, getPowerStanceModel } from "../utils/battleCardMirrorShared";
import { auth } from "../lib/firebase";

const CARD_SIZE = 640;
/** 預留給按鈕組的垂直空間（px），scale 計算時扣除此值避免卡片壓住按鈕 */
const BUTTON_GROUP_RESERVE = 200;

async function showNativeExportFailedAlert(title, message) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Dialog.alert({ title, message });
    } catch (e) {
      console.error("[BattleCard] Dialog.alert failed", e);
      window.alert(`${title}\n\n${message}`);
    }
  } else {
    window.alert(`${title}\n\n${message}`);
  }
}

function isMediaPluginSavePermissionOk(perm) {
  if (!perm || typeof perm !== "object") return false;
  const ok = (v) => v === "granted" || v === "limited";
  if (ok(perm.photos)) return true;
  if (ok(perm.publicStorage13Plus)) return true;
  if (ok(perm.publicStorage)) return true;
  return false;
}

/** 球卡雜訊紋理用 SVG data URL（feTurbulence），重複平鋪 */
const NOISE_DATA_URL =
  // 以更高 baseFrequency + 多一層 octave 產生「更細碎」的顆粒，模擬磨砂金屬質地。
  // Phase 5：改成「水平拉絲」(X/Y baseFrequency 不同)，並用 soft-light 讓顆粒只在有光區閃爍。
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

const BattleCard = forwardRef(function BattleCard({
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
  /** 戰報匯出開始／結束時呼叫，用於暫停 LiveTicker 動畫 */
  onExportStart,
  onExportEnd,
  arenaAnimationsPaused = false,
  exportSceneMode = false,
  disablePortal = false,
  renderScale = 1,
  /** Render Studio / Puppeteer：版面與字型、圖片就緒時觸發一次（供 #render-ready-signal） */
  onReady,
}, ref) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();
  /** 戰報卡根節點（鏡像模式顯示 <img> 時此 ref 暫無 DOM 子節點） */
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const [containerSize, setContainerSize] = useState({
    width: 600,
    height: 600,
  });
  /** isExporting：顯示「生成中」全螢幕遮罩 */
  const [isExporting, setIsExporting] = useState(false);
  /** 快照 Data URL：有值時改顯示 <img> 以利長按儲存／分享 */
  const [mirrorImg, setMirrorImg] = useState(null);
  /** 避免匯出流程 await 期間組件已卸載仍寫入 state */
  const isMountedRef = useRef(true);
  /** 防止連續觸發 handleDownload（雙擊／imperative 重入）造成狀態交錯 */
  const exportInFlightRef = useRef(false);
  /** 非同步匯出完成時讀取「目前」是否仍開啟戰報（避免閉包抓到舊的 open） */
  const openRef = useRef(open);
  openRef.current = open;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const exportReadyOnceRef = useRef(false);
  const stanceColor = status
    ? (STANCE_COLORS[status] ?? STANCE_COLORS.goat)
    : STANCE_COLORS.goat;
  const stanceDisplayName =
    (
      getStance(status)?.primary ??
      (status ? String(status).toUpperCase() : "GOAT")
    ).toUpperCase().trim() || "GOAT";
  const powerStanceModel = useMemo(
    () => getPowerStanceModel(stanceDisplayName),
    [stanceDisplayName],
  );
  const regionText = [country, city].filter(Boolean).join(" · ") || t("global");
  const wallText = String(voterTeam || "LAL").toUpperCase().trim() || "LAL";

  const availableHeight = Math.max(
    0,
    containerSize.height - (exportSceneMode ? 0 : BUTTON_GROUP_RESERVE),
  );
  const computedScale =
    containerSize.width > 0 && containerSize.height > 0
      ? Math.min(
          1,
          containerSize.width / CARD_SIZE,
          availableHeight / CARD_SIZE,
        )
      : 1;
  // 匯出場景固定 1:1，避免裝置 viewport 參與縮放造成裁切/定位漂移
  const scale = exportSceneMode ? 1 : computedScale;
  const studioScale = exportSceneMode ? Math.max(1, Number(renderScale) || 1) : scale;

  useEffect(() => {
    if (!open) {
      setMirrorImg(null);
      return;
    }
    if (!overlayRef.current) return;
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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!exportSceneMode || !open) {
      if (!open) exportReadyOnceRef.current = false;
      return;
    }
    // 無 onReady 時不阻塞：避免一般匯出場景白跑字型／圖片等待
    if (!onReady) return;
    let cancelled = false;
    const run = async () => {
      const imagePromises = Array.from(document.images || []).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      });
      await Promise.allSettled([document.fonts?.ready, Promise.allSettled(imagePromises)]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (cancelled || exportReadyOnceRef.current) return;
      exportReadyOnceRef.current = true;
      onReadyRef.current?.();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [exportSceneMode, open, onReady]);

  const stableMetaTimestamp = useRef(Date.now());

  /**
   * 下載戰報：直接擷取 cardRef DOM（與預覽同一套樣式），再設 mirrorImg。
   * 匯出前先清空鏡像並顯示 loading；原生寫入相簿前仍走 Media 權限（含 limited）。
   */
  const handleDownload = useCallback(
    async (saveOnly = false) => {
      const isExplicitUnlock = saveOnly === true;
      if (!isExportReady && !isExplicitUnlock) {
        if (onRequestRewardAd && onExportUnlock) {
          onRequestRewardAd(() => onExportUnlock());
        }
        return;
      }

      const isNative = Capacitor.isNativePlatform();

      if (isNative && typeof Media.checkPermissions === "function") {
        const check = await Media.checkPermissions();
        if (!isMediaPluginSavePermissionOk(check)) {
          const request = await Media.requestPermissions();
          if (!isMediaPluginSavePermissionOk(request)) {
            await Dialog.alert({
              title: t("galleryPermissionTitle"),
              message: t("needPhotoPermissionToSave"),
            });
            return;
          }
        }
      }

      if (exportInFlightRef.current) {
        return;
      }
      exportInFlightRef.current = true;

      try {
        const safeTitleSlug = battleTitle
          .replace(/[/\\?%*:|"<>]/g, "-")
          .replace(/\s+/g, "-")
          .slice(0, 120);
        const fileBaseWeb = `GOAT-Meter-${safeTitleSlug}-PH8-v${Date.now()}`;

        onExportStart?.();
        const exportPayload = {
          uid: auth?.currentUser?.uid || "",
          photoURL,
          displayName: displayName || t("anonymousWarrior"),
          voterTeam,
          teamLabel,
          status,
          reasonLabels,
          city,
          country,
          rankLabel,
          teamColors,
          battleTitle,
          battleSubtitle,
          warzoneStats,
          isTitleUppercase,
          fileBaseWeb,
        };
        navigate("/battlecard-export", {
          state: {
            exportPayload,
            action: saveOnly ? "save" : "download",
            returnTo: `${location.pathname}${location.search}`,
          },
        });
        return;
      } catch (err) {
        console.error("[BattleCard] export route navigation failed", err);
        await showNativeExportFailedAlert(
          t("exportFailedTitle"),
          isNative ? t("exportFailedNativeRenderAnomalyAdvice") : t("exportFailedUnknown"),
        );
      } finally {
        exportInFlightRef.current = false;
        if (isMountedRef.current) setIsExporting(false);
        onExportEnd?.();
      }
    },
    [
      battleSubtitle,
      battleTitle,
      city,
      country,
      displayName,
      isExportReady,
      isTitleUppercase,
      location.pathname,
      location.search,
      navigate,
      onExportEnd,
      onExportStart,
      onExportUnlock,
      onRequestRewardAd,
      photoURL,
      rankLabel,
      reasonLabels,
      status,
      t,
      teamColors,
      teamLabel,
      voterTeam,
      warzoneStats,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      saveToGallery: () => handleDownload(true),
    }),
    [handleDownload],
  );

  // Layer 1: 升級文字牆（隨機字級/粗細/空心邊框字），但輸出可預期（seed 固定）
  const mixedWallWords = useMemo(() => {
    const wordSpecs = buildWallWordSpecs({ wallText, battleTitle, teamColors });
    const rand = mulberry32(hashStringToSeed(`${wallText}|${battleTitle}|${teamColors.primary}|${teamColors.secondary}`));
    // Smart Watermark（Phase 7）：字牆用「中性銀色」讓壓印在上下雙色背景都能清晰浮現
    const smartSilver = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#e6e6e6", 0.55);
    const hollowStrokeColor = hexWithAlpha(smartSilver, "FF");
    const glitchRed = "rgba(255,0,80,0.35)";
    const glitchCyan = "rgba(0,220,255,0.30)";

    return wordSpecs.map((spec) => {
      const sizeClass = spec.sizeClass;
      const weightClass = spec.isBlackWeight ? "font-black" : "font-thin";
      // 透明度衰減交由「Radial Alpha Decay」(mask) 控制：字體 span 保持 1，避免疊加導致透明度偏移。
      const glowAlpha = spec.glowAlpha;
      const glitchHollow = spec.glitchHollow;
      const glitchBold = weightClass === "font-black" && spec.glitchBold;

      // 每個字牆「詞」的內部字母：每 5 個字隨機出現一個空心邊框字
      const textLen = spec.text.length;
      const hollowIdxByBlock = new Set();
      for (let start = 0; start < textLen; start += 5) {
        const end = Math.min(start + 5, textLen);
        const pick = start + Math.floor(rand() * (end - start));
        hollowIdxByBlock.add(pick);
      }

      const chars = spec.text.split("").map((ch, charIdx) => {
        const isHollow = hollowIdxByBlock.has(charIdx);
        if (isHollow) {
          const glitchShadow = glitchHollow
            ? `, -1px 0 0 ${glitchRed}, 1px 0 0 ${glitchCyan}`
            : "";
          return (
            <span
              // charIdx 在同一個 word span 內穩定，key 用它即可
              key={`${spec.id}-${charIdx}`}
              style={{
                display: "inline-block",
                lineHeight: 1,
                color: "transparent",
                WebkitTextStroke: `1px ${hollowStrokeColor}`,
                opacity: 1,
                textShadow: `0 0 ${Math.round(18 * glowAlpha)}px ${hexWithAlpha(smartSilver, "33")}${glitchShadow}`,
              }}
            >
              {ch}
            </span>
          );
        }

        const glitchShadow = glitchBold ? `, -1px 0 0 ${glitchRed}, 1px 0 0 ${glitchCyan}` : "";
        return (
          <span
            key={`${spec.id}-${charIdx}`}
            style={{
              display: "inline-block",
              lineHeight: 1,
              color: smartSilver,
              opacity: 1,
              textShadow: `0 0 ${Math.round(14 * glowAlpha)}px ${hexWithAlpha(smartSilver, "44")}, 0 0 ${Math.round(
                34 * glowAlpha
              )}px ${hexWithAlpha(smartSilver, "18")}${glitchShadow}`,
            }}
          >
            {ch}
          </span>
        );
      });

      return (
        <span
          key={`wall-word-${spec.id}`}
          className={`${sizeClass} ${weightClass} italic uppercase select-none whitespace-nowrap`}
          aria-hidden
          style={{
            // Phase 7：在上下雙色背景上都呈現清晰金屬壓印
            mixBlendMode: "exclusion",
            filter: "brightness(1.25) saturate(0.9) contrast(1.1)",
          }}
        >
          {chars}
          {" "}
        </span>
      );
    });
  }, [wallText, battleTitle, teamColors]);

  const wallPrimaryGlow = hexWithAlpha(teamColors.primary, "33"); // ~20% alpha
  const wallSecondaryGlow = hexWithAlpha(teamColors.secondary, "26"); // ~15% alpha
  if (!open) return null;

  // Polished Chrome Frame（Phase 6：secondary 為結構、高光）
  const deepSecondary = mixHex(teamColors.secondary, "#000000", 0.62);
  const extremeSecondary = mixHex(teamColors.secondary, "#ffffff", 0.90);
  const neutralSecondary = mixHex(teamColors.secondary, "#bdbdbd", 0.52);
  const brightSecondary = mixHex(teamColors.secondary, "#ffffff", 0.68);

  // Vibrant Frame：拉高 secondary 高亮比例、縮短灰/銀過渡段
  const chromeBorderGradient = `linear-gradient(135deg, ${deepSecondary} 0%, ${extremeSecondary} 20%, ${extremeSecondary} 36%, ${neutralSecondary} 44%, ${brightSecondary} 62%, ${deepSecondary} 100%)`;
  const chromeBorderImage = `${chromeBorderGradient} 1`;

  // Reflective Sweeps：全程使用隊色「變體」而非純白，避免紅變粉、黃不夠亮
  const reflectiveTint20 = hexWithAlpha(teamColors.primary, "20");
  const reflectiveTint40 = hexWithAlpha(teamColors.primary, "40");
  const reflectiveTint60 = hexWithAlpha(teamColors.primary, "60");
  // Secondary tint（Phase 6：primary -> secondary -> primary iridescence）
  const reflectiveSecondaryTint20 = hexWithAlpha(teamColors.secondary, "20");
  const reflectiveSecondaryTint40 = hexWithAlpha(teamColors.secondary, "40");
  const reflectiveSecondaryTint60 = hexWithAlpha(teamColors.secondary, "60");

  // Phase 7：Cross-Color Reflections（冷白核心）；Phase 8 Polish：核心 α 提至 ~0.85 呈白熱高光
  const reflectiveCoreCool = hexWithAlpha(
    mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.78),
    "D9"
  );

  // Phase 8：115deg 雷射切割線（主/副色混合高亮白，非純白）
  const laserCutTint = mixHex(
    mixHex(teamColors.primary, teamColors.secondary, 0.5),
    "#ffffff",
    0.35,
  );
  const laserCutColor = hexWithAlpha(laserCutTint, "E8");

  // HUD Corners（Phase 7）：互補色高光
  const { r: pR, g: pG, b: pB } = hexToRgb(teamColors.primary);
  const { r: sR, g: sG, b: sB } = hexToRgb(teamColors.secondary);
  const complementPrimary = rgbToHex(255 - pR, 255 - pG, 255 - pB);
  const complementSecondary = rgbToHex(255 - sR, 255 - sG, 255 - sB);
  const cornerTopRimAlpha = hexWithAlpha(mixHex(complementPrimary, teamColors.primary, 0.35), "F0");
  const cornerBottomRimAlpha = hexWithAlpha(mixHex(complementSecondary, teamColors.secondary, 0.35), "F0");

  /** Phase 8 Readability：深色隊色描邊，避免小字／標題被 exclusion 或強主色背景吃掉 */
  const textHudEdgeShadow = `0 1px 2px ${hexWithAlpha(mixHex(teamColors.secondary, "#000000", 0.6), "D0")}`;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ isolation: "isolate" }}
    >
      {isExporting ? (
        <div
          className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/90 px-6 pointer-events-auto"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <p className="text-center text-lg font-semibold text-king-gold max-w-sm leading-relaxed">
            {t("generatingHighResReport")}
          </p>
        </div>
      ) : null}
      <motion.div
        ref={overlayRef}
        className={`framer-motion-stabilizer absolute inset-0 flex flex-col items-center bg-black/90 overflow-y-auto ${
          exportSceneMode ? "p-0 pb-0" : "p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        }`}
        data-arena-paused={arenaAnimationsPaused ? "1" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={mirrorImg ? undefined : "battle-card-title"}
        aria-label={mirrorImg ? t("battleCard.mirror_image_alt") : undefined}
        initial={false}
        animate={{ opacity: 1 }}
        exit={exit}
        transition={{ duration: 0.25 }}
        onClick={(e) => {
          if (exportSceneMode) return;
          onClose?.(e);
        }}
      >
        {/* 戰報卡掃描顯影：從上到下的線性掃描遮罩，營造解密／顯影感 */}
        <div className="scan-line" aria-hidden />
        <motion.div
          className="framer-motion-stabilizer flex-1 min-h-0 w-full max-w-full flex flex-col items-center justify-center"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 磁吸簇：縮放後卡片 + 按鈕組同一容器，gap-y-6 緊貼 */}
          <div className="flex flex-col items-center gap-y-6">
          <div className="relative w-full flex items-center justify-center">
            <div
              style={{
                width: CARD_SIZE * studioScale,
                height: CARD_SIZE * studioScale,
              }}
              className="relative flex-shrink-0 overflow-hidden"
            >
              {mirrorImg ? (
                <img
                  src={mirrorImg}
                  alt={t("battleCard.mirror_image_alt")}
                  crossOrigin="anonymous"
                  draggable={false}
                  decoding="async"
                  className="h-full w-full object-contain rounded-2xl shadow-2xl"
                  style={{
                    userSelect: "auto",
                    WebkitUserSelect: "auto",
                    WebkitTouchCallout: "default",
                  }}
                />
              ) : (
                <div
                  ref={cardRef}
                  data-ref="battle-card-ref"
                  className={
                    exportSceneMode
                      ? "relative flex flex-col shrink-0 bg-black text-white rounded-2xl border-2 battlecard-corners-accent"
                      : "absolute left-1/2 top-1/2 flex flex-col shrink-0 bg-black text-white rounded-2xl origin-center border-2 battlecard-corners-accent"
                  }
                style={{
                  width: CARD_SIZE,
                  height: CARD_SIZE,
                  transform: exportSceneMode ? `scale(${studioScale})` : `translate(-50%, -50%) scale(${scale})`,
                  transformOrigin: exportSceneMode ? "top left" : "center",
                  left: exportSceneMode ? 0 : undefined,
                  top: exportSceneMode ? 0 : undefined,
                  borderColor: "transparent",
                  borderImage: chromeBorderImage,
                  borderImageSlice: 1,
                  // Phase 8：115deg 斜向分色基底（Primary/Secondary + 黑能量縫合）
                  backgroundImage: `
                    linear-gradient(
                      115deg,
                      ${hexWithAlpha(teamColors.primary, "FF")} 0%,
                      ${hexWithAlpha(teamColors.primary, "E6")} 45%,
                      rgba(0,0,0,0.8) 50%,
                      ${hexWithAlpha(teamColors.secondary, "E6")} 55%,
                      ${hexWithAlpha(teamColors.secondary, "FF")} 100%
                    ),
                    repeating-linear-gradient(
                      115deg,
                      ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "12")} 0px,
                      ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "12")} 1px,
                      rgba(0,0,0,0) 1px,
                      rgba(0,0,0,0) 10px
                    )
                  `,
                  backgroundSize: "100% 100%, 100% 100%",
                  backgroundPosition: "0 0, 0 0",
                  backgroundRepeat: "no-repeat, no-repeat",
                  // APK：避免 backdrop-filter 加重 WebView 合成成本；飽和/對比僅用 element filter
                  filter: "saturate(1.5) contrast(1.18) brightness(1.06)",
                  boxShadow: `inset 0 0 100px rgba(0,0,0,0.88), 0 0 22px ${hexWithAlpha(teamColors.secondary, "5A")}, inset 0 0 60px ${hexWithAlpha(
                    extremeSecondary,
                    "20"
                  )}, inset 0 0 2px 1px ${hexWithAlpha(teamColors.secondary, "80")}, inset 0 0 1px 0.6px ${hexWithAlpha(
                    mixHex(teamColors.secondary, "#ffffff", 0.97),
                    "E8"
                  )}`,
                }}
              >
                {/* Warzone UI：四角瞄準框（用 pseudo 元素繪製） */}
                <style>{`
                  .battlecard-corners-accent{
                    filter:
                      drop-shadow(0 0 2px ${cornerTopRimAlpha})
                      drop-shadow(0 0 6px ${cornerBottomRimAlpha})
                      drop-shadow(0 0 14px ${hexWithAlpha(teamColors.secondary, "55")});
                  }
                  .battlecard-corners-accent::before,
                  .battlecard-corners-accent::after{
                    content:"";
                    position:absolute;
                    inset:0;
                    pointer-events:none;
                    border-radius:0.75rem;
                    opacity:0.88;
                    z-index:11;
                    mix-blend-mode:normal;
                    background-repeat:no-repeat;
                  }
                  /* top-left & top-right */
                  .battlecard-corners-accent::before{
                    background-image:
                      linear-gradient(${cornerTopRimAlpha}, ${cornerTopRimAlpha}),
                      linear-gradient(${cornerTopRimAlpha}, ${cornerTopRimAlpha}),
                      linear-gradient(${cornerTopRimAlpha}, ${cornerTopRimAlpha}),
                      linear-gradient(${cornerTopRimAlpha}, ${cornerTopRimAlpha});
                    background-size:
                      20px 1px,
                      1px 20px,
                      20px 1px,
                      1px 20px;
                    background-position:
                      0 0,
                      0 0,
                      100% 0,
                      100% 0;
                  }
                  /* bottom-left & bottom-right */
                  .battlecard-corners-accent::after{
                    background-image:
                      linear-gradient(${cornerBottomRimAlpha}, ${cornerBottomRimAlpha}),
                      linear-gradient(${cornerBottomRimAlpha}, ${cornerBottomRimAlpha}),
                      linear-gradient(${cornerBottomRimAlpha}, ${cornerBottomRimAlpha}),
                      linear-gradient(${cornerBottomRimAlpha}, ${cornerBottomRimAlpha});
                    background-size:
                      20px 1px,
                      1px 20px,
                      20px 1px,
                      1px 20px;
                    background-position:
                      0 100%,
                      0 100%,
                      100% 100%,
                      100% 100%;
                  }
                `}</style>

                {/* Layer 1: 浮水印 */}
                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                  {/* Baked-in Lighting：文字牆後方的兩道強力光影（alpha 20% / 15%） */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `
                        radial-gradient(circle at center 30%, ${wallPrimaryGlow} 0%, transparent 62%),
                        radial-gradient(circle at bottom right, ${wallSecondaryGlow} 0%, transparent 58%)
                      `,
                      filter: "saturate(1.2) contrast(1.05)",
                      opacity: 0.95,
                    }}
                    aria-hidden
                  />

                  {/* Phase 8 激光化：49.6%–50.4% 寬漸層 + 多層 drop-shadow 柔邊（消 LED 鋸齒）；第二層 10px 對齊隊色光暈 */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    aria-hidden
                    style={{
                      backgroundImage: `linear-gradient(115deg, transparent 49.6%, ${hexWithAlpha(laserCutColor, "99")} 49.75%, #FFFFFF 50%, ${hexWithAlpha(laserCutColor, "99")} 50.25%, transparent 50.4%)`,
                      mixBlendMode: "normal",
                      opacity: 0.82,
                      filter: `drop-shadow(0 0 2px #FFFFFF) drop-shadow(0 0 10px ${laserCutColor}) drop-shadow(0 0 18px ${hexWithAlpha(laserCutColor, "99")}) contrast(1.4) brightness(1.15)`,
                    }}
                  />

                  {/* Reflective Light Sweeps：145deg 與 SVG 匯出一致，screen 柔化高光 */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    aria-hidden
                    style={{
                      top: "-10%",
                      height: "120%",
                      backgroundImage:
                        // Phase 7：Cross-Color Reflections（斜向覆蓋全卡 + 雙重核心 2%）
                        `linear-gradient(145deg,
                          transparent 18%,
                          ${reflectiveTint20} 22%,
                          ${reflectiveTint60} 24%,
                          ${reflectiveSecondaryTint20} 26%,
                          ${reflectiveSecondaryTint60} 28%,
                          ${reflectiveCoreCool} 29%,
                          ${reflectiveCoreCool} 31%,
                          ${reflectiveTint40} 33%,
                          transparent 45%)`,
                      mixBlendMode: "screen",
                      opacity: 0.9,
                      filter: "contrast(1.2) brightness(1.05)",
                    }}
                  />

                  {/* 升級文字牆：動態混合字級/粗細/空心邊框字，並維持 -15deg 但增加密度 */}
                  <div
                    className="absolute inset-0 flex flex-wrap content-start gap-x-4 gap-y-2 p-4"
                    style={{
                      transform: "rotate(-15deg)",
                      // Phase 8：斜向分色下保持字牆 exclusion 壓印一致性
                      mixBlendMode: "exclusion",
                      opacity: 0.92,
                      filter: "brightness(1.25) saturate(1.2) contrast(1.05)",
                      // Radial Alpha Decay：以「球員照片 / Power Stance」區域為中心的透明度黑洞
                      // 注意：mask 只控制可見性 alpha，避免影響字的排版與預覽版面。
                      WebkitMaskImage:
                        "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.08) 20%, rgba(0,0,0,0.06) 45%, rgba(0,0,0,0.035) 70%, rgba(0,0,0,0.012) 100%)",
                      maskImage:
                        "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.08) 20%, rgba(0,0,0,0.06) 45%, rgba(0,0,0,0.035) 70%, rgba(0,0,0,0.012) 100%)",
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskSize: "100% 100%",
                      maskSize: "100% 100%",
                    }}
                    aria-hidden
                  >
                    {mixedWallWords}
                  </div>
                </div>

                {/* Layer 1b: 球卡雜訊（與 SVG 匯出對齊：低透明度，避免灰塵感） */}
                <div
                  className="absolute inset-0 z-0 opacity-[0.06] pointer-events-none rounded-2xl"
                  aria-hidden
                  style={{
                    backgroundImage: `url("${NOISE_DATA_URL}")`,
                    backgroundRepeat: "repeat",
                  }}
                />

                {/* Color wash：疊在噪點之上（與匯出擷取順序一致） */}
                <div
                  className="absolute inset-0 z-0 pointer-events-none rounded-2xl"
                  aria-hidden
                  style={{
                    background: mixHex(teamColors.primary, teamColors.secondary, 0.5),
                    opacity: 0.2,
                    mixBlendMode: "normal",
                    filter: "saturate(1.25)",
                  }}
                />

                {/* Layer 1b+: 全息戰術遮罩（掃描線 + 20px 點陣網格） */}
                <div
                  className="absolute inset-0 z-[1] pointer-events-none rounded-2xl opacity-90"
                  aria-hidden
                  style={{
                    backgroundImage: `
                      repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px 1px, transparent 1px 20px),
                      repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px 1px, transparent 1px 20px),
                      repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px 1px, transparent 1px 7px)
                    `,
                    filter: "contrast(1.2) brightness(1.05)",
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
                <div
                  className="relative z-20 flex flex-col flex-1 min-h-0 p-5 pb-8"
                  style={{ letterSpacing: "0.02em" }}
                >
                  {/* 稱號：與 SVG STANCE_TITLE_STACK_SHIFT_Y 對齊，頂部多 20px 呼吸空間 */}
                  <div className="text-center uppercase flex-shrink-0 overflow-hidden mb-3 relative pt-5">
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
                      style={{
                        color: hexWithAlpha(stanceColor, "CC"),
                        textShadow: textHudEdgeShadow,
                      }}
                    >
                      {battleSubtitle}
                    </h2>
                    <h1
                      id="battle-card-title"
                      className={`relative text-4xl font-black italic tracking-tighter text-white drop-shadow-lg whitespace-nowrap ${isTitleUppercase ? "uppercase" : "tracking-[0.1em]"}`}
                      style={{
                        color: stanceColor,
                        // 可讀性護邊優先，再接 Phase 8 斜向光暈
                        textShadow: `${textHudEdgeShadow}, 0 0 20px ${hexWithAlpha(stanceColor, "60")}, 0 0 42px ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "45")}, 0 0 60px ${hexWithAlpha(teamColors.secondary, "20")}`,
                      }}
                    >
                      {battleTitle}
                    </h1>
                  </div>

                  {/* 身份區：純色半透明底（APK 避免 backdrop-filter 模糊耗 GPU） */}
                  <div className="relative flex items-center gap-3 flex-shrink-0 mb-3 rounded-xl p-2 overflow-hidden">
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none z-0 bg-black/45"
                      aria-hidden
                    />
                    <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3">
                      <div className="w-12 h-12 flex-shrink-0 overflow-hidden rounded-full border-2 border-white/20 bg-white/10">
                        {photoURL ? (
                          <img
                            src={photoURL}
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xl text-white/60">
                            ?
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pt-2.5 flex flex-col gap-1">
                        <p
                          className="truncate text-sm font-bold text-white leading-snug"
                          style={{ textShadow: textHudEdgeShadow }}
                        >
                          {displayName || t("anonymousWarrior")}
                        </p>
                        <p
                          className="truncate text-sm leading-snug"
                          style={{
                            color: teamColors.primary,
                            textShadow: textHudEdgeShadow,
                          }}
                          title={t("supporting_team", { team: teamLabel })}
                        >
                          {teamLabel
                            ? String(teamLabel).toUpperCase()
                            : t("supporting_team", { team: teamLabel })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Power Stance：折行與縮放 (1–7→120px, 8–10→95px, 11+→90px 折行) + 霓虹 + px-10 安全區；外層 rounded-2xl 與毛玻璃一致 */}
                  <div className="flex-shrink-0 relative flex items-center justify-center mt-2 mb-2 py-6 px-10 overflow-visible rounded-2xl">
                    {/* 毛玻璃襯底：-mx-4 擴張以容納 30px 霓虹光暈，rounded-2xl 柔化邊角 */}
                    <div
                      className="absolute inset-0 -z-10 -mx-4 rounded-2xl bg-black/75"
                      aria-hidden
                      style={{
                        boxShadow: "0 0 50px rgba(0,0,0,0.5)",
                      }}
                    />
                    <div
                      className="relative overflow-visible font-black italic uppercase tracking-tighter select-none text-center"
                      style={{
                        color: stanceColor,
                        textShadow: textHudEdgeShadow,
                        // 白核高光會稀釋隊色飽和度；改為隊色 tinted core 形成 LED 螢光感
                        filter: `drop-shadow(0 0 30px ${stanceColor}) drop-shadow(0 0 18px ${hexWithAlpha(teamColors.primary, "70")}) drop-shadow(0 0 8px ${reflectiveTint60}) drop-shadow(0 2px 3px rgba(0,0,0,1))`,
                      }}
                    >
                      {powerStanceModel.isMultiLine ? (
                        <span className={`block ${powerStanceModel.domClassName}`}>
                          {powerStanceModel.line1}
                          {powerStanceModel.line2 ? (
                            <>
                              <br />
                              {powerStanceModel.line2}
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <span className={powerStanceModel.domClassName}>{powerStanceModel.line1}</span>
                      )}
                    </div>
                  </div>

                  {/* Evidence Locker：裁決證詞區（加深背景 + 彩色文字硬邊際光） */}
                  {reasonLabels.length > 0 && (
                    <div className="flex-shrink-0 rounded-lg p-3 bg-black/70 border border-white/10 mt-2 mb-3 max-h-[120px] overflow-y-auto overflow-x-hidden">
                      <p
                        className="text-[10px] text-white/50 uppercase tracking-[0.2em] mb-1.5"
                        style={{ textShadow: textHudEdgeShadow }}
                      >
                        {t("battleCard.verdict_evidence")}
                      </p>
                      <p className="text-sm font-medium leading-tight">
                        {reasonLabels.map((label, i) => (
                          <span key={i}>
                            {i > 0 && " / "}
                            <span
                              style={{
                                color: stanceColor,
                                textShadow: textHudEdgeShadow,
                              }}
                            >
                              {label}
                            </span>
                          </span>
                        ))}
                      </p>
                    </div>
                  )}

                  {/* 底部：地區 + 排名 + 品牌鋼印區（上提 20px 緩解擁擠，維持安全邊距） */}
                  <div className="mt-auto -mt-5 pt-3 flex flex-wrap items-end justify-between gap-2 border-t border-white/10 px-1">
                    <div className="flex flex-col min-w-0">
                      <span
                        className="truncate text-xs"
                        title={regionText}
                        style={{
                          color: teamColors.primary,
                          filter: "brightness(1.15) saturate(1.2)",
                          textShadow: textHudEdgeShadow,
                        }}
                      >
                        {regionText}
                      </span>
                      <span
                        className="text-white/85 text-xs mt-0.5"
                        title={rankLabel ?? t("rankLabel")}
                        style={{ textShadow: textHudEdgeShadow }}
                      >
                        {rankLabel ?? t("rankLabel")}
                      </span>
                    </div>
                    {/* 品牌鋼印容器：大皇冠單行版 — 靠右、底部對齊、不換行、防擠壓（首發過審：品牌中性化） */}
                    <div
                      className="flex items-end gap-2 justify-end flex-shrink-0"
                      role="group"
                      aria-label={t("goatMeterBrandAria")}
                    >
                      <img
                        src={crownIcon}
                        alt=""
                        crossOrigin="anonymous"
                        className="w-14 h-14 object-contain drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]"
                        aria-hidden
                      />
                      <span
                        className="text-king-gold text-xs font-secondary tracking-[0.2em] uppercase whitespace-nowrap"
                        style={{ textShadow: textHudEdgeShadow }}
                      >
                        The GOAT Meter
                      </span>
                    </div>
                  </div>

                  {/* 免責聲明 */}
                  {/* Warzone UI：底部極細資訊列 */}
                  <p
                    className="text-[6px] text-white/40 mt-2 text-center leading-tight tracking-[0.18em] uppercase"
                    aria-hidden
                    style={{
                      textShadow: `${textHudEdgeShadow}, 0 0 18px ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "1A")}, 0 0 26px ${hexWithAlpha(
                        teamColors.secondary,
                        "14"
                      )}`,
                    }}
                  >
                    {t("battleCard.meta_footer", {
                      timestamp: String(stableMetaTimestamp.current),
                      status: t("verified_data_status"),
                    })}
                  </p>

                  <p
                    className="text-[8px] text-white/40 mt-2 text-center leading-tight"
                    aria-hidden
                    style={{ textShadow: textHudEdgeShadow }}
                  >
                    {t("battleCard.disclaimer")}
                  </p>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* 按鈕組：緊貼卡片下方 (gap-y-6)；解鎖後顯示「下載高解析戰報」存相簿；匯出中隱藏全部操作避免誤觸與流程跳轉 */}
          {!exportSceneMode ? (
          <div className="flex-shrink-0 flex flex-col items-center w-full max-w-sm gap-y-4">
            {!isExporting && isExportReady ? (
              <button
                type="button"
                onClick={() => {
                  triggerHapticPattern([10, 30, 10]);
                  handleDownload(true);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-king-gold bg-king-gold/10 text-king-gold font-bold shadow-[0_0_18px_rgba(212,175,55,0.45)]"
              >
                <Download className="w-5 h-5 shrink-0" aria-hidden />
                {t("downloadHighResReport")}
              </button>
            ) : null}
            {!isExporting && !isExportReady ? (
              <button
                type="button"
                onClick={() => handleDownload()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-king-gold text-black font-bold"
              >
                <Download className="w-5 h-5 shrink-0" aria-hidden />
                {t("downloadReport")}
              </button>
            ) : null}

            <div className={`flex gap-3 w-full ${onRevote ? "" : "flex-col"}`}>
              {onRevote && !isExporting && (
                <motion.button
                  type="button"
                  onClick={onRevote}
                  disabled={revoking}
                  className="flex-1 min-w-0 py-3 px-4 rounded-xl font-medium text-sm text-king-gold/95 bg-white/15 border border-king-gold/30 hover:bg-white/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  whileHover={!revoking ? { scale: 1.02 } : {}}
                  whileTap={!revoking ? { scale: 0.98 } : {}}
                >
                  <RotateCcw className="w-4 h-4 shrink-0" aria-hidden />
                  {revoking ? t("resettingStance") : t("resetStance")}
                </motion.button>
              )}
              {!isExporting && (
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
              )}
            </div>
            {revoteError && !isExporting && (
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
          ) : null}
        </div>
      </motion.div>
    </motion.div>
    </div>
  );

  if (exportSceneMode || disablePortal || typeof document === "undefined") {
    return modalContent;
  }
  return createPortal(modalContent, document.body);
});

export default BattleCard;
