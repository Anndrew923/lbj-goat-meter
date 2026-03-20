/**
 * BattleCard — 戰報卡純 UI（由 BattleCardContainer 注入數據與主題）
 * Layer 1: 動態背景 + 浮水印 + 雜訊紋理 | Layer 2: 邊框光暈 | Layer 3: 稱號、力量標題、證詞、品牌鋼印、免責
 * 固定 1:1 (640×640)，scale-to-fit 縮放；640×640 高清下載需 isExportReady（廣告解鎖後自動觸發一次下載）。
 * 使用 createPortal 掛載至 document.body，脫離 VotePage 內 motion.main 的 stacking context，確保戰報卡顯示於頂部導航欄之上。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Download, RotateCcw } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Media } from "@capacitor-community/media";
import { STANCE_COLORS } from "../lib/constants";
import crownIcon from "../assets/goat-crown-icon.png";
import { hexWithAlpha } from "../utils/colorUtils";
import { getStance } from "../i18n/i18n";
import { triggerHapticPattern } from "../utils/hapticUtils";

const CARD_SIZE = 640;
const GOAT_ALBUM_NAME = "GOAT_Warzone";
/** 預留給按鈕組的垂直空間（px），scale 計算時扣除此值避免卡片壓住按鈕 */
const BUTTON_GROUP_RESERVE = 200;

/** 球卡雜訊紋理用 SVG data URL（feTurbulence），重複平鋪 */
const NOISE_DATA_URL =
  // 以更高 baseFrequency + 多一層 octave 產生「更細碎」的顆粒，模擬磨砂金屬質地。
  // Phase 5：改成「水平拉絲」(X/Y baseFrequency 不同)，並用 soft-light 讓顆粒只在有光區閃爍。
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

/** 取得或建立 GOAT_Warzone 相簿 identifier（原生端用） */
async function ensureGoatAlbumIdentifier() {
  const list = (await Media.getAlbums())?.albums ?? [];
  let album = list.find((a) => a.name === GOAT_ALBUM_NAME);
  if (!album) {
    await Media.createAlbum({ name: GOAT_ALBUM_NAME });
    await new Promise((r) => setTimeout(r, 350));
    const list2 = (await Media.getAlbums())?.albums ?? [];
    album = list2.find((a) => a.name === GOAT_ALBUM_NAME);
  }
  return album?.identifier;
}

/**
 * 極致背景字牆需要「隨機但可預期」的視覺輸出：
 * - preview / toPng 期間不應因 rerender 而變掉
 * - 因此使用字串 hash + PRNG 生成穩定序列
 */
function hashStringToSeed(str) {
  const s = String(str ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace(/^#/, "");
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const n = parseInt(clean, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function rgbToHex(r, g, b) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** mix = 0 => a, mix = 1 => b */
function mixHex(a, b, mix) {
  const ma = hexToRgb(a);
  const mb = hexToRgb(b);
  const t = Math.max(0, Math.min(1, mix));
  return rgbToHex(ma.r + (mb.r - ma.r) * t, ma.g + (mb.g - ma.g) * t, ma.b + (mb.b - ma.b) * t);
}

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
  /** 由 BattleCardContainer 傳入，用於 html-to-image 抓取與存相簿 */
  cardRef: cardRefProp,
  /** 解鎖後存檔至相簿（由 Container 的 handleDownload 提供） */
  onSaveToGallery,
  /** 戰報 toPng 開始／結束時呼叫，用於暫停 LiveTicker 動畫 */
  onExportStart,
  onExportEnd,
}, ref) {
  const { t } = useTranslation("common");
  const internalCardRef = useRef(null);
  const cardRef = cardRefProp ?? internalCardRef;
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

  /** 下載戰報：僅在 isExportReady 或廣告回調傳入的 forceUnlock === true 時執行 640×640 toPng；未解鎖時僅喚起 onRequestRewardAd，無後門。 */
  const handleDownload = useCallback(
    async ({ forceUnlock = false, saveOnly = false } = {}) => {
      const isExplicitUnlock = forceUnlock === true;
      if (!isExportReady && !isExplicitUnlock) {
        if (onRequestRewardAd && onExportUnlock) {
          // 廣告結束後僅解鎖；存檔由「偵察完成，是否存檔？」視窗或「下載高解析戰報」按鈕觸發
          onRequestRewardAd(() => onExportUnlock());
        }
        return;
      }
      // 雙重防護：無 isExportReady 且非廣告回調的顯式 true 時絕不執行 toPng（杜絕 Event 等 truthy 誤觸）
      if (!isExportReady && !isExplicitUnlock) return;
      const el = cardRef.current;
      if (!el) return;
      onExportStart?.();
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

      // 强制双重 rAF（style 变更之后）：确保完成最新 Phase 8 重绘
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      // 强制重排/刷新（黑科技）
      void el.offsetHeight;
      // 硬等待：給瀏覽器足夠「物理時間」完成複雜 115deg/150 字牆渲染
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 若有外部圖片（photoURL），尽可能等 decode/载入完成，避免 toPng 抓到未加载资源
      const imgs = Array.from(el.querySelectorAll("img"));
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise((res) => {
              const t = window.setTimeout(res, 450);
              try {
                if (typeof img.decode === "function") {
                  img.decode().finally(() => {
                    window.clearTimeout(t);
                    res(true);
                  });
                  return;
                }
                if (img.complete) {
                  window.clearTimeout(t);
                  res(true);
                  return;
                }
                img.onload = () => {
                  window.clearTimeout(t);
                  res(true);
                };
                img.onerror = () => {
                  window.clearTimeout(t);
                  res(true);
                };
              } catch {
                window.clearTimeout(t);
                res(true);
              }
            }),
        ),
      );
      // 强制把关键视觉样式重新写回 inline，避免 html-to-image clone 使用到旧 computed snapshot
      const computed = window.getComputedStyle(el);
      el.style.backgroundImage = computed.backgroundImage;
      el.style.backgroundColor = computed.backgroundColor;
      el.style.backgroundSize = computed.backgroundSize;
      el.style.backgroundPosition = computed.backgroundPosition;
      el.style.backgroundRepeat = computed.backgroundRepeat;
      el.style.filter = computed.filter;
      el.style.boxShadow = computed.boxShadow;

      // Phase 8：全子層「暴力樣式鎖定」
      // 只針對 export-critical 層：鎖 backgroundImage / mixBlendMode / filter / opacity
      const exportNodes = el.querySelectorAll("[data-export-role]");
      exportNodes.forEach((node) => {
        const cs = window.getComputedStyle(node);
        node.style.backgroundImage = cs.backgroundImage;
        node.style.mixBlendMode = cs.mixBlendMode;
        node.style.filter = cs.filter;
        node.style.opacity = cs.opacity;
      });

      // Phase 8：強制同步子層（laser-cut / reflective-sweeps），避免 html-to-image clone 用到舊樣式快照
      const laserEl = el.querySelector('[data-export-role="laser-cut"]');
      if (laserEl) {
        const laserCs = window.getComputedStyle(laserEl);
        laserEl.style.backgroundImage = laserCs.backgroundImage;
        laserEl.style.mixBlendMode = laserCs.mixBlendMode;
        laserEl.style.opacity = laserCs.opacity;
        laserEl.style.filter = laserCs.filter;
      }
      const reflectEl = el.querySelector('[data-export-role="reflective-sweeps"]');
      if (reflectEl) {
        const reflectCs = window.getComputedStyle(reflectEl);
        reflectEl.style.backgroundImage = reflectCs.backgroundImage;
        reflectEl.style.mixBlendMode = reflectCs.mixBlendMode;
        reflectEl.style.opacity = reflectCs.opacity;
        reflectEl.style.filter = reflectCs.filter;
        reflectEl.style.top = reflectCs.top;
        reflectEl.style.height = reflectCs.height;
      }

      const exportTag =
        (() => {
          const bg = String(
            (typeof computed.backgroundImage === "string" ? computed.backgroundImage : "") ||
              (typeof el.style.backgroundImage === "string" ? el.style.backgroundImage : ""),
          );
          return bg.includes("115deg") ? "PH8" : "LEGACY";
        })();
      const toPngBaseOpts = {
        // 下載品質：640×640 還原折行與動態字級，填滿畫布無黑邊；pixelRatio:2 銳利化 drop-shadow/text-shadow
        width: CARD_SIZE,
        height: CARD_SIZE,
        backgroundColor: "#050505",
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true, // 避免讀取跨域 CSS（如 Google Fonts）觸發 SecurityError/延遲
      };

      // Phase 8：避免外部 <img>（跨網域）造成 canvas taint -> 導出直接失敗
      // 策略：先正常匯出；若失敗，重試時跳過外部圖片節點，確保至少能輸出「最新背景與字牆」。
      let dataUrl = null;
      try {
        dataUrl = await toPng(el, toPngBaseOpts);
      } catch (err) {
        console.warn("[BattleCard] toPng failed (retry without external IMG)", err);
        try {
          dataUrl = await toPng(el, {
            ...toPngBaseOpts,
            filter: (node) => {
              if (node && node.nodeName === "IMG") {
                const src =
                  node.getAttribute("src") || node.currentSrc || node.src || "";
                if (typeof src === "string" && /^https?:\/\//i.test(src)) {
                  return false;
                }
              }
              return true;
            },
          });
        } catch (err2) {
          console.error("[BattleCard] toPng failed after retry", err2);
        }
      }

      if (dataUrl) {
        if (saveOnly && Capacitor.isNativePlatform()) {
          try {
            const albumIdentifier = await ensureGoatAlbumIdentifier();
            await Media.savePhoto({
              path: dataUrl,
              albumIdentifier: albumIdentifier ?? undefined,
              fileName: `GOAT-Meter-${battleTitle.replace(/\s+/g, "-")}-${exportTag}-${Date.now()}`,
            });
          } catch (saveErr) {
            console.error("[BattleCard] Media.savePhoto failed", saveErr);
          }
        } else {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `GOAT-Meter-${battleTitle.replace(/\s+/g, "-")}-${exportTag}-${Date.now()}.png`;
          a.click();
        }
      }

      el.style.transform = prev.transform;
      el.style.transformOrigin = prev.transformOrigin;
      el.style.left = prev.left;
      el.style.top = prev.top;
      el.style.margin = prev.margin;
      el.style.padding = prev.padding;
      onExportEnd?.();
    },
    [battleTitle, cardRef, isExportReady, onExportUnlock, onRequestRewardAd, onExportStart, onExportEnd],
  );

  useImperativeHandle(
    ref,
    () => ({
      handleDownload,
      saveToGallery: () => handleDownload({ saveOnly: true, forceUnlock: true }),
    }),
    [handleDownload],
  );

  const secondaryWithAlpha = hexWithAlpha(teamColors.secondary, "A0");
  const stableMetaTimestamp = useRef(Date.now());
  const wallText = String(voterTeam || "LAL").toUpperCase().trim() || "LAL";

  // Layer 1: 升級文字牆（隨機字級/粗細/空心邊框字），但輸出可預期（seed 固定）
  const mixedWallWords = useMemo(() => {
    const rand = mulberry32(hashStringToSeed(`${wallText}|${battleTitle}|${teamColors.primary}|${teamColors.secondary}`));
    const sizeClasses = ["text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
    const wallCount = 150; // Phase 8：斜向界面需要更高重疊密度
    // Smart Watermark（Phase 7）：字牆用「中性銀色」讓壓印在上下雙色背景都能清晰浮現
    const smartSilver = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#e6e6e6", 0.55);
    const hollowStrokeColor = hexWithAlpha(smartSilver, "FF");
    const glitchRed = "rgba(255,0,80,0.35)";
    const glitchCyan = "rgba(0,220,255,0.30)";

    return Array.from({ length: wallCount }).map((_, wordIdx) => {
      const sizeClass = sizeClasses[Math.floor(rand() * sizeClasses.length)];
      const weightClass = rand() > 0.5 ? "font-black" : "font-thin";
      // 透明度衰減交由「Radial Alpha Decay」(mask) 控制：字體 span 保持 1，避免疊加導致透明度偏移。
      const glowAlpha = 0.75 + rand() * 0.35;
      const glitchHollow = rand() < 0.28;
      const glitchBold = weightClass === "font-black" && rand() < 0.22;

      // 每個字牆「詞」的內部字母：每 5 個字隨機出現一個空心邊框字
      const textLen = wallText.length;
      const hollowIdxByBlock = new Set();
      for (let start = 0; start < textLen; start += 5) {
        const end = Math.min(start + 5, textLen);
        const pick = start + Math.floor(rand() * (end - start));
        hollowIdxByBlock.add(pick);
      }

      const chars = wallText.split("").map((ch, charIdx) => {
        const isHollow = hollowIdxByBlock.has(charIdx);
        if (isHollow) {
          const glitchShadow = glitchHollow
            ? `, -1px 0 0 ${glitchRed}, 1px 0 0 ${glitchCyan}`
            : "";
          return (
            <span
              // charIdx 在同一個 word span 內穩定，key 用它即可
              key={`${wordIdx}-${charIdx}`}
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
            key={`${wordIdx}-${charIdx}`}
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
          key={`wall-word-${wordIdx}`}
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
  }, [wallText, battleTitle, teamColors.primary, teamColors.secondary]);

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

  // Phase 7：Cross-Color Reflections（冷白核心，不用純白）
  const reflectiveCoreCool = hexWithAlpha(
    mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.78),
    "6F"
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ isolation: "isolate" }}
    >
      <motion.div
        ref={overlayRef}
        className="absolute inset-0 flex flex-col items-center bg-black/90 p-4 backdrop-blur-sm pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-card-title"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={exit}
        transition={{ duration: 0.25 }}
        onClick={() => onClose?.()}
      >
        {/* 戰報卡掃描顯影：從上到下的線性掃描遮罩，營造解密／顯影感 */}
        <div className="scan-line" aria-hidden />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex-1 min-h-0 w-full max-w-full flex flex-col items-center justify-center"
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
                data-ref="battle-card-ref"
                className="absolute left-1/2 top-1/2 flex flex-col bg-black text-white rounded-2xl origin-center border-2 battlecard-corners-accent"
                style={{
                  width: CARD_SIZE,
                  height: CARD_SIZE,
                  transform: `translate(-50%, -50%) scale(${scale})`,
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
                  // Forced Saturation：鎖定主色飽和度，避免高光把紅/黃稀釋
                  backdropFilter: "saturate(1.8) contrast(1.1)",
                  WebkitBackdropFilter: "saturate(1.8) contrast(1.1)",
                  // Phase 6：色彩/對比微調（保持鏡面，但不壓扁 secondary）
                  filter: "saturate(1.4) contrast(1.1)",
                  boxShadow: `inset 0 0 100px rgba(0,0,0,0.88), 0 0 22px ${hexWithAlpha(teamColors.secondary, "5A")}, inset 0 0 60px ${hexWithAlpha(
                    extremeSecondary,
                    "20"
                  )}, inset 0 0 2px 1px ${hexWithAlpha(teamColors.secondary, "80")}, inset 0 0 1px 0.6px ${hexWithAlpha(
                    mixHex(teamColors.secondary, "#ffffff", 0.97),
                    "E8"
                  )}`,
                }}
              >
                {/* Warzone UI：四角瞄準框（用 pseudo 元素繪製，確保 toPng 也能抓到） */}
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
                    opacity:0.95;
                    z-index:11;
                    mix-blend-mode:screen;
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

                  {/* Phase 8：50% 雷射切割線（115deg，screen 混合，非純白） */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    aria-hidden
                    data-export-role="laser-cut"
                    style={{
                      backgroundImage: `linear-gradient(115deg, transparent 49.9%, ${laserCutColor} 50%, transparent 50.1%)`,
                      mixBlendMode: "screen",
                      opacity: 0.98,
                      filter: "contrast(1.35) brightness(1.1) blur(0.1px)",
                    }}
                  />

                  {/* Reflective Light Sweeps：斜向反射光掃描帶 */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    aria-hidden
                    data-export-role="reflective-sweeps"
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
                      mixBlendMode: "overlay",
                      opacity: 0.95,
                      filter: "contrast(1.2) brightness(1.05)",
                    }}
                  />

                  {/* Color Wash Layer：主色噴鍍（疊在 Layer 1 背景上方） */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    aria-hidden
                    style={{
                      // Phase 6：讓基底 secondary 主導色彩結構，避免雙色融合後仍被 primary 淹沒
                      background: mixHex(teamColors.primary, teamColors.secondary, 0.5),
                      opacity: 0.16,
                      mixBlendMode: "overlay",
                      filter: "saturate(1.25)",
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
                      // 注意：mask 只控制可見性 alpha，避免影響字的排版與 toPng 版面。
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

                {/* Layer 1b: 球卡雜訊紋理 (analog noise, mix-blend-overlay) */}
                <div
                  className="absolute inset-0 z-0 opacity-[0.18] mix-blend-soft-light pointer-events-none rounded-2xl"
                  aria-hidden
                  style={{
                    backgroundImage: `url("${NOISE_DATA_URL}")`,
                    backgroundRepeat: "repeat",
                  }}
                />

                {/* Layer 1b+: 全息戰術遮罩（掃描線 + 20px 點陣網格） */}
                <div
                  className="absolute inset-0 z-[1] pointer-events-none rounded-2xl mix-blend-overlay"
                  aria-hidden
                  style={{
                    backgroundImage: `
                      repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px 1px, transparent 1px 20px),
                      repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px 1px, transparent 1px 20px),
                      repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px 1px, transparent 1px 7px)
                    `,
                    filter: "contrast(1.2) brightness(1.05)",
                    opacity: 1,
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
                        // Phase 8：斜向光影一致立體感（同時吃到 primary/secondary）
                        textShadow: `0 0 20px ${hexWithAlpha(stanceColor, "60")}, 0 0 42px ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "45")}, 0 0 60px ${hexWithAlpha(teamColors.secondary, "20")}`,
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
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
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
                    style={{
                      boxShadow: "0 0 50px rgba(0,0,0,0.5)",
                    }}
                    />
                    <div
                      className="relative overflow-visible font-black italic uppercase tracking-tighter select-none text-center"
                      style={{
                        color: stanceColor,
                      // 白核高光會稀釋隊色飽和度；改為隊色 tinted core 形成 LED 螢光感
                      filter: `drop-shadow(0 0 30px ${stanceColor}) drop-shadow(0 0 18px ${hexWithAlpha(teamColors.primary, "70")}) drop-shadow(0 0 8px ${reflectiveTint60}) drop-shadow(0 2px 3px rgba(0,0,0,1))`,
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

                  {/* 底部：地區 + 排名 + 品牌鋼印區（上提 20px 緩解擁擠，維持安全邊距） */}
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
                    {/* 品牌鋼印容器：大皇冠單行版 — 靠右、底部對齊、不換行、防擠壓（首發過審：品牌中性化） */}
                    <div
                      className="flex items-end gap-2 justify-end flex-shrink-0"
                      role="group"
                      aria-label={t("goatMeterBrandAria")}
                    >
                      <img
                        src={crownIcon}
                        alt=""
                        className="w-14 h-14 object-contain drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]"
                        aria-hidden
                      />
                      <span
                        className="text-king-gold text-xs font-secondary tracking-[0.2em] uppercase whitespace-nowrap"
                      >
                        The GOAT Meter
                      </span>
                    </div>
                  </div>

                  {/* 免責聲明 */}
                  {/* Warzone UI：底部極細資訊列（toPng 會一併渲染） */}
                  <p
                    className="text-[6px] text-white/40 mt-2 text-center leading-tight tracking-[0.18em] uppercase"
                    aria-hidden
                    style={{
                      // Bottom-half semantic：secondary 區塊語意
                      textShadow: `0 0 18px ${hexWithAlpha(mixHex(teamColors.primary, teamColors.secondary, 0.5), "1A")}, 0 0 26px ${hexWithAlpha(
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
                  >
                    {t("battleCard.disclaimer")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 按鈕組：緊貼卡片下方 (gap-y-6)；解鎖後顯示「下載高解析戰報」存相簿 */}
          <div className="flex-shrink-0 flex flex-col items-center w-full max-w-sm gap-y-4">
            {isExportReady && onSaveToGallery ? (
              <button
                type="button"
                onClick={() => {
                  triggerHapticPattern([10, 30, 10]);
                  onSaveToGallery();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-king-gold bg-king-gold/10 text-king-gold font-bold animate-border-blink"
              >
                <Download className="w-5 h-5 shrink-0" aria-hidden />
                {t("downloadHighResReport")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleDownload()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-king-gold text-black font-bold"
              >
                <Download className="w-5 h-5 shrink-0" aria-hidden />
                {t("downloadReport")}
              </button>
            )}

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
    </div>
  );

  return createPortal(modalContent, document.body);
});

export default BattleCard;
