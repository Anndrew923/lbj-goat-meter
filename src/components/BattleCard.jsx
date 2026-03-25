/**
 * BattleCard — 戰報卡純 UI（由 BattleCardContainer 注入數據與主題）
 * Layer 1: 動態背景 + 浮水印 + 雜訊紋理 | Layer 2: 邊框光暈 | Layer 3: 稱號、力量標題、證詞、品牌鋼印、免責
 * 固定 1:1 (640×640)，scale-to-fit 縮放；原生高清存相簿需 isExportReady（首次下載經廣告解鎖後由 VotingArena 直接觸發 saveToGallery）。
 * 使用 createPortal 掛載至 document.body，脫離 VotePage 內 motion.main 的 stacking context，確保戰報卡顯示於頂部導航欄之上。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Download, RotateCcw } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Dialog } from "@capacitor/dialog";
import { Media } from "@capacitor-community/media";
import { Screenshot } from "capacitor-screenshot";
import { STANCE_COLORS } from "../lib/constants";
import crownIcon from "../assets/goat-crown-icon.png";
import { hexWithAlpha } from "../utils/colorUtils";
import { getStance } from "../i18n/i18n";
import { triggerHapticPattern } from "../utils/hapticUtils";

const CARD_SIZE = 640;
/** 原生裁切輸出最小邊長（邏輯 640 × 2x DPR ≈ 1280 物理像素） */
const NATIVE_EXPORT_MIN_PX = 1280;
/** 視窗×dpr 與截圖實際寬高差距超過此像素時，改以 IW/innerWidth 等反推倍率，對齊 Realme／Android 14 等非標準 WebView 截圖 */
const CROP_BITMAP_MISMATCH_TOLERANCE_PX = 2;
const GOAT_ALBUM_NAME = "GOAT_Warzone";
/** 預留給按鈕組的垂直空間（px），scale 計算時扣除此值避免卡片壓住按鈕 */
const BUTTON_GROUP_RESERVE = 200;
/** 保守派：廣告關閉後給足 GPU 重繪時間，再進入快門隱身；不追求極限快門、追求成功率 */
const EXPORT_PAINT_WAIT_MS = 1500;
/** 在基礎等待之後，額外輪詢 img.complete && naturalWidth 的最長時間（弱網） */
const EXPORT_IMAGE_READY_MAX_WAIT_MS = 2000;
/** 圖片就緒輪詢間隔，平衡 CPU 與回應速度 */
const EXPORT_IMAGE_POLL_INTERVAL_MS = 50;
/** 裁切時在點陣圖上內縮的像素（每邊），避免截到螢幕邊緣黑底／雜訊 */
const CROP_SAFETY_INSET_PX = 2;
/** 截圖寬／高對視窗的縮放比視為「等向」的相對誤差閾值（用於選擇單一 map 或分軸 scale） */
const CROP_SCALE_AXIS_UNIFORM_EPS = 0.02;
/** Hammer Lock：將全螢幕截圖縮畫後，僅在戰報卡對應區域抽樣（非全畫面黑底） */
const HAMMER_LOCK_CANVAS_PX = 1000;
/** 戰報卡內九宮格：邊緣內縮比例，採樣落於本體而非全螢幕黑底 */
const HAMMER_CARD_EDGE_INSET = 0.1;
const HAMMER_FRAC_LO = HAMMER_CARD_EDGE_INSET;
const HAMMER_FRAC_MID = 0.5;
const HAMMER_FRAC_HI = 1 - HAMMER_CARD_EDGE_INSET;
/**
 * 相對 layoutRect 的 3×3 網格（四角、四邊中點、中心）；列優先，索引 6–8 為底邊三點。
 */
const HAMMER_CARD_SAMPLE_REL = [
  [HAMMER_FRAC_LO, HAMMER_FRAC_LO],
  [HAMMER_FRAC_MID, HAMMER_FRAC_LO],
  [HAMMER_FRAC_HI, HAMMER_FRAC_LO],
  [HAMMER_FRAC_LO, HAMMER_FRAC_MID],
  [HAMMER_FRAC_MID, HAMMER_FRAC_MID],
  [HAMMER_FRAC_HI, HAMMER_FRAC_MID],
  [HAMMER_FRAC_LO, HAMMER_FRAC_HI],
  [HAMMER_FRAC_MID, HAMMER_FRAC_HI],
  [HAMMER_FRAC_HI, HAMMER_FRAC_HI],
];
/** 死像素：RGB 總和嚴格小於此值（規格 <10，含近黑灰階） */
const HAMMER_DEAD_PIXEL_RGB_SUM_LT = 10;
/** 超過此死像素數量 → 截圖無效（規格：>3 個點） */
const HAMMER_MAX_DEAD_PIXELS = 3;
/** 中央抽樣 alpha 下限；過低代表合成未完成／半圖 */
const HAMMER_CENTER_ALPHA_MIN = 250;
/** 原生匯出：畫面品質探針解析度（僅用來打分，不影響最終裁切輸出） */
const NATIVE_QUALITY_PROBE_SIZE_PX = 128;
/** 原生匯出：取樣 stride（越小越精準但越耗時） */
const NATIVE_QUALITY_SAMPLE_STRIDE_PX = 8;
/** 原生匯出：通過條件（針對“非全黑/非半圖”的最低可靠信號） */
const NATIVE_QUALITY_PASS_NONBLACK_RATIO = 0.08;
const NATIVE_QUALITY_PASS_CENTER_ALPHA = 80;
/** 原生匯出：最小候選門檻；低於此代表“幾乎必黑/幾乎必半圖” */
const NATIVE_QUALITY_MIN_NONBLACK_RATIO = 0.04;
const NATIVE_QUALITY_MIN_CENTER_ALPHA = 40;
/** 原生匯出：用來做“亮度最低保障”的歸一化門檻（0~1；rgbSum/765） */
const NATIVE_QUALITY_MIN_AVG_BRIGHTNESS_NORM = 0.02;
/** 與 HAMMER_CARD_SAMPLE_REL 列優先 3×3 對齊：中心點 alpha 檢查 */
const HAMMER_CENTER_SAMPLE_INDEX = 4;
/** 底部列三點索引（半圖常見底黑） */
const HAMMER_BOTTOM_ROW_INDICES = [6, 7, 8];
const HAMMER_BOTTOM_ROW_INDEX_SET = new Set(HAMMER_BOTTOM_ROW_INDICES);
/** Shutter Decoupling：setIsCapturing(true) 後等待，讓遮罩卸載與 CSS 變形／重繪落地再快門 */
const NATIVE_SHUTTER_DOM_WAIT_MS = 250;
/** 原生截圖「破冰重拍」上限 */
const NATIVE_HAMMER_MAX_ATTEMPTS = 3;
/** 第 1 次失敗後等待再拍 */
const NATIVE_AFTER_FAIL1_MS = 300;
/** 第 2 次失敗後等待再拍（並可執行 padding 破冰） */
const NATIVE_AFTER_FAIL2_MS = 800;
/** 第 3 次仍失敗：等待後再提示（讓遮罩／合成完全落地） */
const NATIVE_AFTER_FAIL3_MS = 1200;

async function nextAnimationFrames(count) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}

function cropScalesAreUniform(scaleX, scaleY) {
  return Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) < CROP_SCALE_AXIS_UNIFORM_EPS;
}

/**
 * 與 cropNativeScreenshotToElement 一致：由截圖點陣 (IW×IH) 與視窗推算 map／scale。
 * 用於 Hammer 將「戰報卡上的點」映射到點陣座標，避免採到 App 黑底。
 */
function getNativeScreenshotPixelMapping(IW, IH) {
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  if (!innerW || !innerH || !IW || !IH) return null;

  const dpr = window.devicePixelRatio || 1;
  const scaleX = IW / innerW;
  const scaleY = IH / innerH;
  const expectedW = innerW * dpr;
  const expectedH = innerH * dpr;
  const bitmapMatchesDpr =
    Math.abs(IW - expectedW) <= CROP_BITMAP_MISMATCH_TOLERANCE_PX &&
    Math.abs(IH - expectedH) <= CROP_BITMAP_MISMATCH_TOLERANCE_PX;

  let map;
  if (bitmapMatchesDpr) {
    map = dpr;
  } else {
    map = cropScalesAreUniform(scaleX, scaleY) ? (scaleX + scaleY) / 2 : scaleX;
  }

  const uniform = cropScalesAreUniform(scaleX, scaleY);
  return { map, scaleX, scaleY, bitmapMatchesDpr, uniform };
}

/**
 * 文件座標系下的點（= viewport 座標 + pageX/YOffset，與 crop 的 rect.left+ox 相同語意）→ 點陣像素。
 */
function nativeDocPointToBitmapPx(docX, docY, IW, IH, mapping) {
  let bx = Math.round(docX * mapping.map);
  let by = Math.round(docY * mapping.map);
  if (!mapping.bitmapMatchesDpr && !mapping.uniform) {
    bx = Math.round(docX * mapping.scaleX);
    by = Math.round(docY * mapping.scaleY);
  }
  bx = Math.max(0, Math.min(bx, IW - 1));
  by = Math.max(0, Math.min(by, IH - 1));
  return [bx, by];
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("[BattleCard] image decode failed"));
    img.src = dataUrl;
  });
}

/**
 * 像素級驗收（Dynamic Area Hammer）：依 layoutRect 在戰報卡本體內九宮格採樣（1000×1000 縮圖座標），
 * 不採全螢幕黑底。死像素 r+g+b<10；>3 個死像素或底邊三點全死 → 失敗；中央 alpha 過低 → 半圖。
 */
async function validateNativeScreenshotBase64(base64, layoutRect) {
  if (!base64 || typeof base64 !== "string") return false;
  if (
    !layoutRect ||
    typeof layoutRect.width !== "number" ||
    typeof layoutRect.height !== "number" ||
    layoutRect.width <= 0 ||
    layoutRect.height <= 0
  ) {
    return false;
  }

  const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  let img;
  try {
    img = await loadImageFromDataUrl(dataUrl);
  } catch {
    return false;
  }

  const IW = img.naturalWidth;
  const IH = img.naturalHeight;
  const mapping = getNativeScreenshotPixelMapping(IW, IH);
  if (!mapping) return false;

  const ox = window.pageXOffset;
  const oy = window.pageYOffset;
  const maxC = HAMMER_LOCK_CANVAS_PX - 1;

  /** @type {Array<[number, number]>} */
  const pointsCanvas = [];
  for (let i = 0; i < HAMMER_CARD_SAMPLE_REL.length; i += 1) {
    const [fx, fy] = HAMMER_CARD_SAMPLE_REL[i];
    const docX = layoutRect.left + ox + fx * layoutRect.width;
    const docY = layoutRect.top + oy + fy * layoutRect.height;
    const [bx, by] = nativeDocPointToBitmapPx(docX, docY, IW, IH, mapping);
    const cx = Math.max(0, Math.min(maxC, Math.floor((bx / IW) * HAMMER_LOCK_CANVAS_PX)));
    const cy = Math.max(0, Math.min(maxC, Math.floor((by / IH) * HAMMER_LOCK_CANVAS_PX)));
    pointsCanvas.push([cx, cy]);
  }

  const canvas = document.createElement("canvas");
  canvas.width = HAMMER_LOCK_CANVAS_PX;
  canvas.height = HAMMER_LOCK_CANVAS_PX;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  try {
    ctx.drawImage(img, 0, 0, HAMMER_LOCK_CANVAS_PX, HAMMER_LOCK_CANVAS_PX);
  } catch {
    return false;
  }

  let centerAlpha = 255;
  let deadCount = 0;
  let bottomDeadCount = 0;
  const isDeadPixel = (r, g, b) => r + g + b < HAMMER_DEAD_PIXEL_RGB_SUM_LT;

  for (let i = 0; i < pointsCanvas.length; i += 1) {
    const [x, y] = pointsCanvas[i];
    let d;
    try {
      d = ctx.getImageData(x, y, 1, 1).data;
    } catch {
      return false;
    }
    const r = d[0];
    const g = d[1];
    const b = d[2];
    const a = d[3];
    if (isDeadPixel(r, g, b)) {
      deadCount += 1;
      if (HAMMER_BOTTOM_ROW_INDEX_SET.has(i)) bottomDeadCount += 1;
    }
    if (i === HAMMER_CENTER_SAMPLE_INDEX) centerAlpha = a;
  }

  if (deadCount > HAMMER_MAX_DEAD_PIXELS) return false;
  if (bottomDeadCount === HAMMER_BOTTOM_ROW_INDICES.length) return false;
  if (centerAlpha < HAMMER_CENTER_ALPHA_MIN) return false;
  return true;
}

/**
 * 原生匯出品質打分：比 validateNativeScreenshotBase64 更“抗抖”。
 * 設計意圖：
 * - 你要求“幾乎 100% 成功率且失敗主要歸因於網路/資源未就緒”
 * - validateNativeScreenshotBase64 目前採九宮格硬閾值，對邊界幀/合成時序非常敏感
 * - 這裡改成把“layoutRect 對齊裁切來源”投影到小畫布後，做連續指標（非全黑比例/中心 alpha/平均亮度）
 * - 結果用 score 選擇最佳候選，避免因偶發誤判導致 Dialog.alert 提前 return
 *
 * @returns {{
 *   score: number,
 *   pass: boolean,
 *   passMin: boolean,
 *   nonBlackRatio: number,
 *   centerAlphaAvg: number,
 *   avgBrightnessNorm: number
 * }}
 */
async function scoreNativeScreenshotBase64(base64, layoutRect) {
  if (!base64 || typeof base64 !== "string") {
    return {
      score: 0,
      pass: false,
      passMin: false,
      nonBlackRatio: 0,
      centerAlphaAvg: 0,
      avgBrightnessNorm: 0,
    };
  }
  if (
    !layoutRect ||
    typeof layoutRect.width !== "number" ||
    typeof layoutRect.height !== "number" ||
    layoutRect.width <= 0 ||
    layoutRect.height <= 0
  ) {
    return {
      score: 0,
      pass: false,
      passMin: false,
      nonBlackRatio: 0,
      centerAlphaAvg: 0,
      avgBrightnessNorm: 0,
    };
  }

  const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  const img = await loadImageFromDataUrl(dataUrl);
  const IW = img.naturalWidth;
  const IH = img.naturalHeight;
  if (!IW || !IH) {
    return {
      score: 0,
      pass: false,
      passMin: false,
      nonBlackRatio: 0,
      centerAlphaAvg: 0,
      avgBrightnessNorm: 0,
    };
  }

  const ox = window.pageXOffset;
  const oy = window.pageYOffset;
  const mapping = getNativeScreenshotPixelMapping(IW, IH);
  if (!mapping) {
    return {
      score: 0,
      pass: false,
      passMin: false,
      nonBlackRatio: 0,
      centerAlphaAvg: 0,
      avgBrightnessNorm: 0,
    };
  }

  // 來源座標計算（以 X/Y 軸分軸縮放；避免非等比縮放時仍走 mapping.map 造成裁切偏移/失真）
  let sx = Math.round((layoutRect.left + ox) * mapping.scaleX);
  let sy = Math.round((layoutRect.top + oy) * mapping.scaleY);
  let sw = Math.round(layoutRect.width * mapping.scaleX);
  let sh = Math.round(layoutRect.height * mapping.scaleY);

  const inset = CROP_SAFETY_INSET_PX;
  sx += inset;
  sy += inset;
  sw = Math.max(1, sw - 2 * inset);
  sh = Math.max(1, sh - 2 * inset);

  sx = Math.max(0, Math.min(sx, IW - 1));
  sy = Math.max(0, Math.min(sy, IH - 1));
  sw = Math.max(1, Math.min(sw, IW - sx));
  sh = Math.max(1, Math.min(sh, IH - sy));

  // 強制來源裁切來源為正方形：避免 sw/sh 不等導致拉伸，影響“黑/半圖”指標
  const side = Math.max(1, Math.min(sw, sh));
  // 將正方形來源區塊在原矩形內置中，避免 sw!=sh 時從左上角硬裁切造成觀感“壓扁/裁壓”
  const dx = sw - side;
  const dy = sh - side;
  sx += Math.floor(dx / 2);
  sy += Math.floor(dy / 2);
  sw = side;
  sh = side;
  sx = Math.max(0, Math.min(sx, IW - sw));
  sy = Math.max(0, Math.min(sy, IH - sh));

  const canvas = document.createElement("canvas");
  canvas.width = NATIVE_QUALITY_PROBE_SIZE_PX;
  canvas.height = NATIVE_QUALITY_PROBE_SIZE_PX;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      score: 0,
      pass: false,
      passMin: false,
      nonBlackRatio: 0,
      centerAlphaAvg: 0,
      avgBrightnessNorm: 0,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, NATIVE_QUALITY_PROBE_SIZE_PX, NATIVE_QUALITY_PROBE_SIZE_PX);

  const imageData = ctx.getImageData(0, 0, NATIVE_QUALITY_PROBE_SIZE_PX, NATIVE_QUALITY_PROBE_SIZE_PX);
  const data = imageData.data;

  let total = 0;
  let nonBlack = 0;
  let brightnessSum = 0; // rgbSum/765 (0~1) 累加後再平均
  let centerAlphaSum = 0;
  let centerAlphaCount = 0;

  const stride = NATIVE_QUALITY_SAMPLE_STRIDE_PX;
  const half = Math.floor(NATIVE_QUALITY_PROBE_SIZE_PX / 2);
  const centerRadiusPx = Math.floor(NATIVE_QUALITY_PROBE_SIZE_PX * 0.15);

  for (let y = 0; y < NATIVE_QUALITY_PROBE_SIZE_PX; y += stride) {
    for (let x = 0; x < NATIVE_QUALITY_PROBE_SIZE_PX; x += stride) {
      const idx = (y * NATIVE_QUALITY_PROBE_SIZE_PX + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      total += 1;
      const rgbSum = r + g + b; // 0~765
      const brightnessNorm = rgbSum / 765;
      brightnessSum += brightnessNorm;

      // 非黑：需要有顯示 alpha + 足夠亮度
      if (a > 0 && rgbSum >= HAMMER_DEAD_PIXEL_RGB_SUM_LT) {
        nonBlack += 1;
      }

      // 中心區域：判斷合成是否完成的粗信號（半圖時中心常偏低 alpha）
      if (Math.abs(x - half) <= centerRadiusPx && Math.abs(y - half) <= centerRadiusPx) {
        centerAlphaSum += a;
        centerAlphaCount += 1;
      }
    }
  }

  const nonBlackRatio = total > 0 ? nonBlack / total : 0;
  const centerAlphaAvg = centerAlphaCount > 0 ? centerAlphaSum / centerAlphaCount : 0;
  const avgBrightnessNorm = total > 0 ? brightnessSum / total : 0;

  // 綜合分數：讓“非全黑”權重大於 alpha/亮度，確保黑屏不過關
  const score =
    nonBlackRatio * 60 +
    (centerAlphaAvg / 255) * 25 +
    avgBrightnessNorm * 15;

  const pass = nonBlackRatio >= NATIVE_QUALITY_PASS_NONBLACK_RATIO && centerAlphaAvg >= NATIVE_QUALITY_PASS_CENTER_ALPHA && avgBrightnessNorm >= NATIVE_QUALITY_MIN_AVG_BRIGHTNESS_NORM;
  const passMin = nonBlackRatio >= NATIVE_QUALITY_MIN_NONBLACK_RATIO && centerAlphaAvg >= NATIVE_QUALITY_MIN_CENTER_ALPHA && avgBrightnessNorm >= NATIVE_QUALITY_MIN_AVG_BRIGHTNESS_NORM / 2;

  return {
    score,
    pass,
    passMin,
    nonBlackRatio,
    centerAlphaAvg,
    avgBrightnessNorm,
  };
}

/** 微幅改變透明度再還原，促使 HWC／TextureView 走一次合成路徑（GT Neo 3 等黑屏緩解） */
function nudgeCardOpacityForGpuSwap(cardEl) {
  const hadInline = cardEl.style.opacity !== "";
  const prev = cardEl.style.opacity;
  try {
    cardEl.style.opacity = "0.99";
    void cardEl.offsetHeight;
    cardEl.style.opacity = "1";
    void cardEl.offsetHeight;
  } finally {
    if (hadInline) cardEl.style.opacity = prev;
    else cardEl.style.removeProperty("opacity");
  }
}

/**
 * 物理破冰：微調 padding（1px）迫使排版／合成管線刷新，下一幀還原，避免持久位移。
 * Realme GT Neo 3 / Android 14 WebView 半圖緩解用。
 */
async function nudgeCardPaddingBottomIcebreak(cardEl) {
  const had = cardEl.style.paddingBottom !== "";
  const prev = cardEl.style.paddingBottom;
  cardEl.style.paddingBottom = "1px";
  void cardEl.offsetHeight;
  await nextAnimationFrames(1);
  if (had) cardEl.style.paddingBottom = prev;
  else cardEl.style.removeProperty("padding-bottom");
}

/**
 * 暴力破冰：強制 display 切換迫使 WebView 丟棄 GPU 快取，緩解半圖／失敗粘滯。
 * 戰報卡根節點為 flex 排版（與 class flex flex-col 一致）。
 */
async function aggressiveDisplayIcebreak(cardEl) {
  cardEl.style.display = "none";
  void cardEl.offsetHeight;
  cardEl.style.display = "flex";
  void cardEl.offsetHeight;
  await nextAnimationFrames(2);
  cardEl.style.removeProperty("display");
  void cardEl.offsetHeight;
}

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

/**
 * 截圖前確認 card 內所有 <img> 已解碼且可見（complete + naturalWidth>0）。
 * 弱網下 decode() 可能仍無像素；額外最多等 EXPORT_IMAGE_READY_MAX_WAIT_MS。
 * 若首次檢查未就緒則呼叫 onSlow（切換遮罩文案）；逾時仍繼續截圖並 warn。
 */
async function waitForCardImagesPaintReady(rootEl, maxWaitMs, onSlow) {
  const listImgs = () => Array.from(rootEl.querySelectorAll("img"));
  const allReady = () => {
    const imgs = listImgs();
    if (imgs.length === 0) return true;
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  };

  if (allReady()) return;

  onSlow?.();

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (allReady()) return;
    await new Promise((r) => setTimeout(r, EXPORT_IMAGE_POLL_INTERVAL_MS));
  }

  if (!allReady()) {
    console.warn("[BattleCard] waitForCardImagesPaintReady: timeout, screenshot may be incomplete");
  }
}

/** 盡力觸發戰報卡根節點內所有 img 的 decode／onload，與 waitForCardImagesPaintReady 搭配使用。 */
async function decodeBattleCardImages(rootEl) {
  const imgs = Array.from(rootEl.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((res) => {
          const decodeTimer = window.setTimeout(res, 450);
          try {
            if (typeof img.decode === "function") {
              img.decode().finally(() => {
                window.clearTimeout(decodeTimer);
                res(true);
              });
              return;
            }
            if (img.complete) {
              window.clearTimeout(decodeTimer);
              res(true);
              return;
            }
            img.onload = () => {
              window.clearTimeout(decodeTimer);
              res(true);
            };
            img.onerror = () => {
              window.clearTimeout(decodeTimer);
              res(true);
            };
          } catch {
            window.clearTimeout(decodeTimer);
            res(true);
          }
        }),
    ),
  );
}

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

/** 存相簿成功後的原生 Toast；失敗僅記 log，不影響匯出流程。 */
async function showBattleReportSavedToast(text) {
  try {
    const { Toast } = await import("@capacitor/toast");
    await Toast.show({
      text,
      duration: "short",
      position: "bottom",
    });
  } catch (e) {
    console.error("[BattleCard] Toast.show failed", e);
  }
}

/**
 * 原生全畫面截圖（物理像素）→ 依 card 的 document 對齊座標裁切為 1:1 正方形。
 * @param layoutRect 須與 Screenshot.take() 緊鄰取得的 getBoundingClientRect()；呼叫前不可改動 transform。
 * - 核心：sx/sy 分別依 X/Y 軸對齊；sourceWidth/sourceHeight（sw/sh）分開計算以避免非等比縮放時的裁切偏移。
 * - map 優先為 devicePixelRatio；若截圖像素與 inner×dpr 不符，改用 (scaleX+scaleY)/2 單一倍率對齊點陣（不依賴 screen.height-innerHeight）。
 * - Safety Inset：在點陣座標內縮 CROP_SAFETY_INSET_PX，避免邊緣黑帶入鏡。
 */
async function cropNativeScreenshotToElement(fullBase64, layoutRect) {
  const dataUrl = fullBase64.startsWith("data:")
    ? fullBase64
    : `data:image/png;base64,${fullBase64}`;
  const img = new Image();
  img.decoding = "async";
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("[BattleCard] crop: image load failed"));
    img.src = dataUrl;
  });

  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  const IW = img.naturalWidth;
  const IH = img.naturalHeight;

  if (!innerW || !innerH || !IW || !IH) {
    throw new Error("[BattleCard] crop: invalid layout or image dimensions");
  }

  const wCss = layoutRect.width;
  const hCss = layoutRect.height;
  if (wCss <= 0 || hCss <= 0) {
    throw new Error("[BattleCard] crop: invalid layoutRect dimensions");
  }

  const ox = window.pageXOffset;
  const oy = window.pageYOffset;

  const mapping = getNativeScreenshotPixelMapping(IW, IH);
  if (!mapping) {
    throw new Error("[BattleCard] crop: invalid layout or image dimensions");
  }

  // 來源座標計算（以 X/Y 軸分軸縮放；避免非等比縮放時仍走 mapping.map 造成裁切偏移/失真）
  let sx = Math.round((layoutRect.left + ox) * mapping.scaleX);
  let sy = Math.round((layoutRect.top + oy) * mapping.scaleY);
  let sw = Math.round(layoutRect.width * mapping.scaleX);
  let sh = Math.round(layoutRect.height * mapping.scaleY);

  const inset = CROP_SAFETY_INSET_PX;
  sx += inset;
  sy += inset;
  sw = Math.max(1, sw - 2 * inset);
  sh = Math.max(1, sh - 2 * inset);

  sx = Math.max(0, Math.min(sx, IW - 1));
  sy = Math.max(0, Math.min(sy, IH - 1));
  sw = Math.max(1, Math.min(sw, IW - sx));
  sh = Math.max(1, Math.min(sh, IH - sy));

  // 目標輸出仍維持正方形：取 sw/sh 中較小的邊長並在原矩形內置中，避免裁切偏移造成觀感“壓扁/裁壓”
  const side = Math.max(1, Math.min(sw, sh));
  const dx = sw - side;
  const dy = sh - side;
  sx += Math.floor(dx / 2);
  sy += Math.floor(dy / 2);
  sw = side;
  sh = side;
  sx = Math.max(0, Math.min(sx, IW - sw));
  sy = Math.max(0, Math.min(sy, IH - sh));
  const out = Math.max(side, NATIVE_EXPORT_MIN_PX);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[BattleCard] crop: 2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out, out);
  return canvas.toDataURL("image/png");
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
  /** 戰報 toPng 開始／結束時呼叫，用於暫停 LiveTicker 動畫 */
  onExportStart,
  onExportEnd,
  arenaAnimationsPaused = false,
}, ref) {
  const { t } = useTranslation("common");
  /** 戰報卡根節點：唯一下載路徑 toPng 目標（不可由 Container 分岔） */
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const [containerSize, setContainerSize] = useState({
    width: 600,
    height: 600,
  });
  /** isExporting：顯示「生成中」全螢幕遮罩；isCapturing：快門前 true 以卸載遮罩 DOM，避免 Screenshot 拍到遮罩 */
  const [isExporting, setIsExporting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  /** 圖片尚未就緒時改為慢速文案（弱網提示） */
  const [exportSlowResourceCopy, setExportSlowResourceCopy] = useState(false);
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

  /**
   * 下載戰報：原生端走「階梯式」WebView 點陣截圖 + 九宮格驗收；Web 端維持 toPng + 飽和度補償。
   * 不可改動卡片 transform，否則截圖座標與畫面脫鉤。
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
      const el = cardRef.current;
      if (!el) return;

      const isNative = Capacitor.isNativePlatform();

      flushSync(() => {
        setIsExporting(true);
        setExportSlowResourceCopy(false);
      });

      try {
        if (isNative) {
          // —— 第一階：環境鎖定（全螢幕「生成中」+ 圖片 100% 讀取／解碼）——
          onExportStart?.();
          await nextAnimationFrames(2);
          await decodeBattleCardImages(el);
          await waitForCardImagesPaintReady(el, EXPORT_IMAGE_READY_MAX_WAIT_MS, () => {
            flushSync(() => {
              setExportSlowResourceCopy(true);
            });
          });

          const exportTag = `PH8-v${Date.now()}`;
          const fileBase = `GOAT-Meter-${battleTitle.replace(/\s+/g, "-")}-${exportTag}`;

          // —— 第二階：渲染解耦（隱藏遮罩後死等 NATIVE_SHUTTER_DOM_WAIT_MS，讓 DOM 與合成落地）——
          flushSync(() => {
            setIsCapturing(true);
          });
          await new Promise((r) => setTimeout(r, NATIVE_SHUTTER_DOM_WAIT_MS));

          let layoutRect = null;
          let shot = null;
          let bestShot = null;
          let bestLayoutRect = null;
          let bestQuality = null;

          for (let attempt = 1; attempt <= NATIVE_HAMMER_MAX_ATTEMPTS; attempt += 1) {
            // —— 第三階：物理喚醒與破冰（非首拍才 display 強制刷新，擊碎 GPU 緩存粘滯）——
            if (attempt === 2) {
              await new Promise((r) => setTimeout(r, NATIVE_AFTER_FAIL1_MS));
            } else if (attempt === 3) {
              await new Promise((r) => setTimeout(r, NATIVE_AFTER_FAIL2_MS));
            }
            nudgeCardOpacityForGpuSwap(el);
            await nudgeCardPaddingBottomIcebreak(el);
            if (attempt > 1) {
              await aggressiveDisplayIcebreak(el);
            }
            await nextAnimationFrames(2);

            // —— 第四階：九宮格驗收（Screenshot.take + validateNativeScreenshotBase64；失敗則回到第三階重試，最多 3 次）——
            layoutRect = el.getBoundingClientRect();
            if (layoutRect.width <= 0 || layoutRect.height <= 0) {
              console.error("[BattleCard] Native export: invalid card rect", layoutRect);
              shot = null;
              continue;
            }

            try {
              shot = await Screenshot.take();
            } catch (e) {
              console.error("[BattleCard] Screenshot.take failed", e);
              shot = null;
            }

            if (!shot?.base64) continue;

            try {
              const quality = await scoreNativeScreenshotBase64(shot.base64, layoutRect);
              if (!bestQuality || quality.score > bestQuality.score) {
                bestQuality = quality;
                bestShot = shot;
                bestLayoutRect = layoutRect;
              }
              // 只要達到 pass，就可以直接跳出；否則繼續找“最佳候選”降低偶發誤殺風險。
              if (quality.pass) break;
            } catch (e) {
              console.error("[BattleCard] scoreNativeScreenshotBase64 failed", e);
            }
          }

          flushSync(() => {
            setIsCapturing(false);
          });

          // —— 第五階：結果產出（失敗則誠實建議 Dialog；成功則裁切 → 存相簿 → Toast）——
          if (!bestShot?.base64 || !bestLayoutRect || !bestQuality || !bestQuality.passMin) {
            await new Promise((r) => setTimeout(r, NATIVE_AFTER_FAIL3_MS));
            await showNativeExportFailedAlert(
              t("exportFailedTitle"),
              t("exportFailedNativeRenderAnomalyAdvice"),
            );
            return;
          }

          let dataUrl;
          try {
            dataUrl = await cropNativeScreenshotToElement(bestShot.base64, bestLayoutRect);
          } catch (e) {
            console.error("[BattleCard] cropNativeScreenshotToElement failed", e);
            await showNativeExportFailedAlert(
              t("exportFailedTitle"),
              t("exportFailedNativeRenderAnomalyAdvice"),
            );
            return;
          }

          if (dataUrl) {
            if (saveOnly) {
              try {
                const albumIdentifier = await ensureGoatAlbumIdentifier();
                await Media.savePhoto({
                  path: dataUrl,
                  albumIdentifier: albumIdentifier ?? undefined,
                  fileName: fileBase,
                });
                await showBattleReportSavedToast(t("battleReportSavedToGallery"));
              } catch (saveErr) {
                console.error("[BattleCard] Media.savePhoto failed", saveErr);
                await showNativeExportFailedAlert(
                  t("exportFailedTitle"),
                  t("exportFailedSavePhotoAdvice"),
                );
              }
            } else {
              const a = document.createElement("a");
              a.href = dataUrl;
              a.download = `${fileBase}.png`;
              a.click();
            }
          }
          return;
        }

        // —— Web：維持既有 toPng 路徑（含 EXPORT_PAINT_WAIT_MS 與資源就緒輪詢）——
        await new Promise((r) => setTimeout(r, EXPORT_PAINT_WAIT_MS));
        onExportStart?.();
        await decodeBattleCardImages(el);
        await waitForCardImagesPaintReady(el, EXPORT_IMAGE_READY_MAX_WAIT_MS, () => {
          flushSync(() => {
            setExportSlowResourceCopy(true);
          });
        });

        const exportTag = `PH8-v${Date.now()}`;
        const fileBase = `GOAT-Meter-${battleTitle.replace(/\s+/g, "-")}-${exportTag}`;

        /** Web：toPng 前備份／還原 DOM，避免 clone 殘影 */
        const roleStyleBackup = new Map(
          Array.from(el.querySelectorAll("[data-export-role]")).map((n) => [n, n.style.cssText]),
        );
        const rootPaintBackup = {
          backgroundImage: el.style.backgroundImage,
          backgroundColor: el.style.backgroundColor,
          backgroundSize: el.style.backgroundSize,
          backgroundPosition: el.style.backgroundPosition,
          backgroundRepeat: el.style.backgroundRepeat,
          filter: el.style.filter,
          boxShadow: el.style.boxShadow,
          backdropFilter: el.style.getPropertyValue("backdrop-filter"),
          webkitBackdropFilter: el.style.getPropertyValue("-webkit-backdrop-filter"),
        };

        /** html-to-image 易吃掉飽和／對比：在 inline 上疊加補償，縮小與原生截圖的觀感落差 */
        const applyExportSnapshot = () => {
          const computed = window.getComputedStyle(el);
          el.style.backgroundImage = computed.backgroundImage;
          el.style.backgroundColor = computed.backgroundColor;
          el.style.backgroundSize = computed.backgroundSize;
          el.style.backgroundPosition = computed.backgroundPosition;
          el.style.backgroundRepeat = computed.backgroundRepeat;
          // filter: none 時不可串接，否則整段 filter 會被瀏覽器視為無效
          const filterBase =
            computed.filter && computed.filter !== "none" ? computed.filter : "";
          el.style.filter =
            `${filterBase} saturate(1.6) contrast(1.1) brightness(1.05)`.trim();
          el.style.boxShadow = computed.boxShadow;
          el.style.setProperty("backdrop-filter", computed.getPropertyValue("backdrop-filter"));
          el.style.setProperty(
            "-webkit-backdrop-filter",
            computed.getPropertyValue("-webkit-backdrop-filter"),
          );
          el.querySelectorAll("[data-export-role]").forEach((node) => {
            const cs = window.getComputedStyle(node);
            const role = node.getAttribute("data-export-role");
            if (role === "text-wall-container") {
              node.style.transform = cs.transform;
              node.style.mixBlendMode = cs.mixBlendMode;
              node.style.opacity = cs.opacity;
              node.style.filter = cs.filter;
              node.style.webkitMaskImage = cs.webkitMaskImage;
              node.style.maskImage = cs.maskImage;
              node.style.webkitMaskRepeat = cs.webkitMaskRepeat;
              node.style.maskRepeat = cs.maskRepeat;
              node.style.webkitMaskSize = cs.webkitMaskSize;
              node.style.maskSize = cs.maskSize;
            } else {
              // laser-cut / reflective-sweeps 等：同步 filter，避免 html-to-image clone 與實際算繪不一致
              node.style.backgroundImage = cs.backgroundImage;
              node.style.mixBlendMode = cs.mixBlendMode;
              node.style.filter = cs.filter;
              node.style.opacity = cs.opacity;
            }
          });
        };

        const restoreExportDomStyles = () => {
          el.style.backgroundImage = rootPaintBackup.backgroundImage;
          el.style.backgroundColor = rootPaintBackup.backgroundColor;
          el.style.backgroundSize = rootPaintBackup.backgroundSize;
          el.style.backgroundPosition = rootPaintBackup.backgroundPosition;
          el.style.backgroundRepeat = rootPaintBackup.backgroundRepeat;
          el.style.filter = rootPaintBackup.filter;
          el.style.boxShadow = rootPaintBackup.boxShadow;
          el.style.setProperty("backdrop-filter", rootPaintBackup.backdropFilter);
          el.style.setProperty("-webkit-backdrop-filter", rootPaintBackup.webkitBackdropFilter);
          roleStyleBackup.forEach((cssText, node) => {
            if (node.isConnected) node.style.cssText = cssText;
          });
        };

        try {
          applyExportSnapshot();

          const toPngBaseOpts = {
            width: CARD_SIZE,
            height: CARD_SIZE,
            backgroundColor: "#050505",
            pixelRatio: 2,
            cacheBust: true,
            skipFonts: true,
          };

          let dataUrl = null;
          try {
            dataUrl = await toPng(el, toPngBaseOpts);
          } catch {
            const TRANSPARENT_PIXEL =
              "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
            const imgNodes = Array.from(el.querySelectorAll("img"));
            const externalImgNodes = imgNodes.filter((img) => {
              const src =
                img.getAttribute("src") || img.currentSrc || img.src || "";
              return typeof src === "string" && /^https?:\/\//i.test(src);
            });
            const savedSources = externalImgNodes.map((img) => ({
              img,
              src: img.getAttribute("src") || img.currentSrc || img.src || "",
            }));

            try {
              externalImgNodes.forEach((img) => {
                img.setAttribute("src", TRANSPARENT_PIXEL);
              });
              applyExportSnapshot();
              dataUrl = await toPng(el, toPngBaseOpts);
            } catch (err2) {
              console.error("[BattleCard] toPng failed after retry", err2);
            } finally {
              savedSources.forEach(({ img, src }) => {
                if (src) img.setAttribute("src", src);
                else img.removeAttribute("src");
              });
            }
          }

          if (dataUrl) {
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `${fileBase}.png`;
            a.click();
          }
        } finally {
          restoreExportDomStyles();
        }
      } finally {
        flushSync(() => {
          setExportSlowResourceCopy(false);
          setIsCapturing(false);
          setIsExporting(false);
        });
        onExportEnd?.();
      }
    },
    [battleTitle, isExportReady, onExportUnlock, onRequestRewardAd, onExportStart, onExportEnd, t],
  );

  useImperativeHandle(
    ref,
    () => ({
      saveToGallery: () => handleDownload(true),
    }),
    [handleDownload],
  );

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
      {isExporting && !isCapturing ? (
        <div
          className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/90 px-6 pointer-events-auto"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <p className="text-center text-lg font-semibold text-king-gold max-w-sm leading-relaxed">
            {exportSlowResourceCopy ? t("exportSlowResources") : t("generatingHighResReport")}
          </p>
        </div>
      ) : null}
      <motion.div
        ref={overlayRef}
        className="framer-motion-stabilizer absolute inset-0 flex flex-col items-center bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto"
        data-arena-paused={arenaAnimationsPaused ? "1" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-card-title"
        initial={false}
        animate={{ opacity: 1 }}
        exit={exit}
        transition={{ duration: 0.25 }}
        onClick={(e) => onClose?.(e)}
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
                width: CARD_SIZE * scale,
                height: CARD_SIZE * scale,
              }}
              className="relative flex-shrink-0 overflow-hidden"
            >
              <div
                ref={cardRef}
                data-ref="battle-card-ref"
                className="absolute left-1/2 top-1/2 flex flex-col shrink-0 bg-black text-white rounded-2xl origin-center border-2 battlecard-corners-accent"
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
                    data-export-role="laser-cut"
                    style={{
                      backgroundImage: `linear-gradient(115deg, transparent 49.6%, ${hexWithAlpha(laserCutColor, "99")} 49.75%, #FFFFFF 50%, ${hexWithAlpha(laserCutColor, "99")} 50.25%, transparent 50.4%)`,
                      mixBlendMode: "normal",
                      opacity: 0.82,
                      filter: `drop-shadow(0 0 2px #FFFFFF) drop-shadow(0 0 10px ${laserCutColor}) drop-shadow(0 0 18px ${hexWithAlpha(laserCutColor, "99")}) contrast(1.4) brightness(1.15)`,
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
                      mixBlendMode: "normal",
                      opacity: 0.9,
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
                      opacity: 0.2,
                      mixBlendMode: "normal",
                      filter: "saturate(1.25)",
                    }}
                  />

                  {/* 升級文字牆：動態混合字級/粗細/空心邊框字，並維持 -15deg 但增加密度 */}
                  <div
                    data-export-role="text-wall-container"
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

                {/* Layer 1b: 球卡雜訊紋理（WebView：避免 mix-blend，改純透明度） */}
                <div
                  className="absolute inset-0 z-0 opacity-[0.2] pointer-events-none rounded-2xl"
                  aria-hidden
                  style={{
                    backgroundImage: `url("${NOISE_DATA_URL}")`,
                    backgroundRepeat: "repeat",
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
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-bold text-white"
                          style={{ textShadow: textHudEdgeShadow }}
                        >
                          {displayName || t("anonymousWarrior")}
                        </p>
                        <p
                          className="truncate text-sm"
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
                  {/* Warzone UI：底部極細資訊列（toPng 會一併渲染） */}
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
            </div>
          </div>

          {/* 按鈕組：緊貼卡片下方 (gap-y-6)；解鎖後顯示「下載高解析戰報」存相簿；匯出中隱藏全部操作避免誤觸與流程跳轉 */}
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
        </div>
      </motion.div>
    </motion.div>
    </div>
  );

  return createPortal(modalContent, document.body);
});

export default BattleCard;
