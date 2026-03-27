/**
 * 戰報卡純 Canvas 匯出管線（1080×1080 PNG），與 BattleCard 預覽視覺 DNA 對齊。
 * 不依賴 html-to-image / DOM clone。
 */

import { Capacitor } from "@capacitor/core";
import { hexWithAlpha } from "./colorUtils";
import {
  hashStringToSeed,
  hexToRgb,
  mixHex,
  mulberry32,
  rgbToHex,
} from "./battleCardVisualMath";
import crownIcon from "../assets/goat-crown-icon.png";

/** 設計座標 640×640，與 BattleCard.jsx CARD_SIZE 一致 */
export const BATTLE_CARD_DESIGN_SIZE = 640;
/** 匯出像素（雙平台一致） */
export const BATTLE_CARD_EXPORT_SIZE = 1080;

const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

const WALL_COUNT = 150;
const WALL_SIZE_PX = [36, 48, 60, 72, 96, 128]; // text-4xl … text-9xl @ 16px root

/** 稱號／證詞區單行最大寬度（設計座標 px） */
const MAX_BODY_TEXT_WIDTH = 580;
const TITLE_MAX_LINES = 5;
const EVIDENCE_BODY_MAX_LINES = 12;
const EVIDENCE_FONT_SIZE = 14;
const EVIDENCE_LEFT = 20;
/** 與下方 footer 第一行同步（相對底緣；整體上提時一併調整證詞可用高度） */
function designFooterFirstLineY(designSize) {
  return designSize - 64;
}
function evidenceMaxBottomY(designSize) {
  return designFooterFirstLineY(designSize) - 6;
}
/** 設計座標：footer 區 meta／免責行距底緣（與 footer 上提聯動調整） */
const FOOTER_META_LINE_FROM_BOTTOM = 40;
const FOOTER_DISCLAIMER_FROM_BOTTOM = 26;
const TITLE_BLOCK_TOP = 14;
const GAP_AFTER_SUBTITLE = 16;
const GAP_AFTER_TITLE_BLOCK = 6;
/** 身分列與 Power Stance 之間（對齊 DOM compact） */
const GAP_ID_TO_POWER = 22;

/**
 * 單字過寬時依字元斷行（設計意圖：長 URL／無空白字串仍不溢出）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} word
 * @param {number} maxWidth
 * @returns {string[]}
 */
function breakLongWord(ctx, word, maxWidth) {
  const out = [];
  let chunk = "";
  for (const ch of word) {
    const test = chunk + ch;
    if (ctx.measureText(test).width <= maxWidth) {
      chunk = test;
    } else {
      if (chunk) out.push(chunk);
      if (ctx.measureText(ch).width <= maxWidth) {
        chunk = ch;
      } else {
        /* 單一字元仍超寬（極端字級／emoji）：仍輸出，避免空轉與無限迴圈 */
        out.push(ch);
        chunk = "";
      }
    }
  }
  if (chunk) out.push(chunk);
  return out;
}

/**
 * 將文字依空白斷行，必要時對單一 token 做字元斷行。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapTextToLines(ctx, text, maxWidth) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      if (ctx.measureText(word).width > maxWidth) {
        const parts = breakLongWord(ctx, word, maxWidth);
        lines.push(...parts.slice(0, -1));
        line = parts[parts.length - 1] ?? "";
      } else {
        line = word;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * 稱號：在 maxWidth 內換行，必要時遞減字級至最小值；仍過長則截斷最後一行加省略號。
 * @returns {{ lines: string[], fontSize: number, lineHeight: number }}
 */
function fitBattleTitleLines(ctx, text, isItalicTitle, maxWidth, maxLines) {
  const italic = isItalicTitle ? "italic " : "";
  const minSize = 18;
  const maxSize = 36;
  for (let fontSize = maxSize; fontSize >= minSize; fontSize -= 2) {
    ctx.font = `${italic}900 ${fontSize}px Inter, system-ui, sans-serif`;
    const lines = wrapTextToLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      return {
        lines,
        fontSize,
        lineHeight: Math.round(fontSize * 1.18),
      };
    }
  }
  ctx.font = `${italic}900 ${minSize}px Inter, system-ui, sans-serif`;
  let lines = wrapTextToLines(ctx, text, maxWidth);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    const ell = "…";
    while (last.length > 1 && ctx.measureText(`${last.slice(0, -1)}${ell}`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last.replace(/\s+$/, "")}${ell}`;
  }
  return {
    lines,
    fontSize: minSize,
    lineHeight: Math.round(minSize * 1.18),
  };
}

/**
 * 稱號：在 maxWidth 內換行繪製（置中、可遞減字級），避免長標題裁切。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {object} opts
 * @param {number} [opts.maxWidth]
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {string} opts.fillStyle
 * @param {boolean} [opts.isItalicTitle]
 * @param {number} [opts.shadowBlur]
 * @param {string} [opts.shadowColor]
 * @param {number} [opts.maxLines] 最多行數（預設 TITLE_MAX_LINES）
 * @returns {number} 最後一行底緣之後的 Y（下一區塊起點）
 */
export function drawWrappedText(ctx, text, opts) {
  const {
    maxWidth = MAX_BODY_TEXT_WIDTH,
    x,
    y,
    fillStyle,
    isItalicTitle = false,
    shadowBlur = 0,
    shadowColor = "transparent",
    maxLines: maxTitleLines = TITLE_MAX_LINES,
  } = opts;
  const { lines, fontSize, lineHeight } = fitBattleTitleLines(
    ctx,
    text,
    isItalicTitle,
    maxWidth,
    maxTitleLines,
  );
  ctx.font = `${isItalicTitle ? "italic " : ""}900 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = shadowBlur;
  ctx.shadowColor = shadowColor;
  ctx.shadowOffsetY = 0;
  let drawY = y;
  for (const line of lines) {
    ctx.fillText(line, x, drawY);
    drawY += lineHeight;
  }
  return drawY;
}

/**
 * 證詞：多段顏色 token 排版，每行寬度不超過 maxWidth。
 * @returns {Array<Array<{ text: string, color: string }>>}
 */
function layoutEvidenceTokenLines(ctx, reasonLabels, stanceColor, maxWidth) {
  const sep = " / ";
  /** @type {{ text: string, color: string }[]} */
  const tokens = [];
  const labels = (reasonLabels ?? []).map((l) => String(l ?? "").trim()).filter(Boolean);
  labels.forEach((label, i) => {
    if (i > 0) {
      tokens.push({ text: sep, color: "rgba(255,255,255,0.9)" });
    }
    tokens.push({ text: label, color: stanceColor });
  });
  if (tokens.length === 0) return [];

  ctx.font = `500 ${EVIDENCE_FONT_SIZE}px Inter, sans-serif`;
  /** @type {Array<Array<{ text: string, color: string }>>} */
  const lines = [];
  /** @type {Array<{ text: string, color: string }>} */
  let current = [];
  let lineW = 0;

  const flush = () => {
    if (current.length) {
      lines.push(current);
      current = [];
      lineW = 0;
    }
  };

  for (const tok of tokens) {
    const tw = ctx.measureText(tok.text).width;
    if (lineW + tw <= maxWidth) {
      current.push(tok);
      lineW += tw;
      continue;
    }
    flush();
    if (tw <= maxWidth) {
      current.push(tok);
      lineW = tw;
      continue;
    }
    const subLines = breakLongWord(ctx, tok.text, maxWidth).filter((p) => p.length > 0);
    subLines.forEach((piece) => {
      lines.push([{ text: piece, color: tok.color }]);
    });
  }
  flush();
  return lines;
}

/**
 * Power Stance 區塊底緣（textBaseline=top），供證詞區起點計算，避免與 footer 重疊。
 */
function estimatePowerStanceBottom(ctx, psPx, long, line2, line1, psCenterY) {
  ctx.font = `italic 900 ${psPx}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const lineH = (txt, y) => {
    const m = ctx.measureText(txt);
    const asc = m.actualBoundingBoxAscent ?? psPx * 0.72;
    const desc = m.actualBoundingBoxDescent ?? psPx * 0.2;
    return y + asc + desc;
  };
  if (long && line2) {
    const y1 = psCenterY - psPx * 0.45;
    const y2 = psCenterY + psPx * 0.4;
    return Math.max(lineH(line1, y1), lineH(line2, y2));
  }
  return lineH(line1, psCenterY);
}

/**
 * 多層 shadow 疊加霓虹感，最後一筆無 shadow 鎖定邊緣。
 */
function drawPowerStanceNeon(ctx, cx, line1, line2, long, psCenterY, psPx, stanceColor, tp, ts) {
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `italic 900 ${psPx}px Inter, system-ui, sans-serif`;
  const glowPasses = [
    { blur: 40, color: hexWithAlpha(stanceColor, "AA") },
    { blur: 24, color: hexWithAlpha(tp, "88") },
    { blur: 14, color: hexWithAlpha(ts, "77") },
    { blur: 6, color: "rgba(255,255,255,0.28)" },
  ];
  const drawGlowStack = (text, y) => {
    glowPasses.forEach(({ blur, color }) => {
      ctx.shadowBlur = blur;
      ctx.shadowColor = color;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = stanceColor;
      ctx.fillText(text, cx, y);
    });
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.fillStyle = stanceColor;
    ctx.fillText(text, cx, y);
  };
  if (long && line2) {
    drawGlowStack(line1, psCenterY - psPx * 0.45);
    drawGlowStack(line2, psCenterY + psPx * 0.4);
  } else {
    drawGlowStack(line1, psCenterY);
  }
}

/**
 * 在 clip 內繪製預設頭像佔位（金屬灰＋簡化剪影），避免載入失敗時區塊空洞。
 */
function drawAvatarPlaceholderDisc(ctx, avX, avY, avR) {
  const cx = avX + avR;
  const cy = avY + avR;
  const g = ctx.createRadialGradient(cx, cy - avR * 0.2, 0, cx, cy, avR * 1.35);
  g.addColorStop(0, "#7a7a82");
  g.addColorStop(0.55, "#4e4e56");
  g.addColorStop(1, "#323238");
  ctx.fillStyle = g;
  ctx.fillRect(avX, avY, avR * 2, avR * 2);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.arc(cx, cy - avR * 0.1, avR * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + avR * 0.52, avR * 0.52, avR * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @typedef {Object} BattleReportCanvasInput
 * @property {{ primary: string, secondary: string }} teamColors
 * @property {string} stanceColor
 * @property {string} battleTitle
 * @property {string} battleSubtitle
 * @property {string} displayName
 * @property {string} teamLineText
 * @property {string} regionText
 * @property {string} rankLineText
 * @property {string[]} reasonLabels
 * @property {string} stanceDisplayName
 * @property {string} wallText
 * @property {string} [photoURL]
 * @property {string} metaFooterLine
 * @property {string} disclaimerLine
 * @property {string} evidenceLabel
 * @property {string} brandLine
 * @property {boolean} isTitleUppercase
 */

/**
 * @param {string} src
 * @param {{ platform?: string }} [opts]
 * @returns {Promise<HTMLImageElement>}
 */
export function loadBattleReportImage(src, opts = {}) {
  const platform = opts.platform ?? Capacitor.getPlatform();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = async () => {
      if (platform === "ios" && typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          /* 仍嘗試使用已載入像素 */
        }
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`[battleReportCanvas] image load failed: ${src}`));
    img.src = src;
  });
}

async function ensureDocumentFontsReady() {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    /* ignore */
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 模擬字牆 flex-wrap，與 BattleCard 相同 seed／字級池／空心規則。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} designSize
 */
function drawTextWallLayer(ctx, input, designSize) {
  const { teamColors, wallText, battleTitle } = input;
  const rand = mulberry32(
    hashStringToSeed(
      `${wallText}|${battleTitle}|${teamColors.primary}|${teamColors.secondary}`,
    ),
  );
  const smartSilver = mixHex(
    mixHex(teamColors.primary, teamColors.secondary, 0.5),
    "#e6e6e6",
    0.55,
  );
  const hollowStrokeColor = hexWithAlpha(smartSilver, "FF");
  const wallFill = "#e6e6e6";

  const pad = 16;
  const gapY = 8;
  let x = pad;
  let y = pad;
  let rowMaxH = 0;

  const textUpper = String(wallText || "LAL").toUpperCase().trim() || "LAL";

  for (let wordIdx = 0; wordIdx < WALL_COUNT; wordIdx += 1) {
    const sizePx = WALL_SIZE_PX[Math.floor(rand() * WALL_SIZE_PX.length)];
    const weight = rand() > 0.5 ? "900" : "100";
    const glowAlpha = 0.75 + rand() * 0.35;
    const glitchHollow = rand() < 0.28;
    const glitchBold = weight === "900" && rand() < 0.22;
    const glitchRed = "rgba(255,0,80,0.35)";
    const glitchCyan = "rgba(0,220,255,0.30)";

    const hollowIdxByBlock = new Set();
    for (let start = 0; start < textUpper.length; start += 5) {
      const end = Math.min(start + 5, textUpper.length);
      const pick = start + Math.floor(rand() * (end - start));
      hollowIdxByBlock.add(pick);
    }

    ctx.font = `italic ${weight} ${sizePx}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "alphabetic";

    let wordWidth = 0;
    const charLayouts = [];
    for (let charIdx = 0; charIdx < textUpper.length; charIdx += 1) {
      const ch = textUpper[charIdx];
      const m = ctx.measureText(ch);
      charLayouts.push({ ch, w: m.width, hollow: hollowIdxByBlock.has(charIdx) });
      wordWidth += m.width;
    }
    const spaceW = ctx.measureText(" ").width;
    wordWidth += spaceW;

    if (x + wordWidth > designSize - pad && x > pad) {
      x = pad;
      y += rowMaxH + gapY;
      rowMaxH = 0;
    }

    let cx = x;
    const lineY = y + sizePx * 0.85;
    rowMaxH = Math.max(rowMaxH, sizePx + gapY);

    for (let i = 0; i < charLayouts.length; i += 1) {
      const { ch, w, hollow } = charLayouts[i];
      if (hollow) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.strokeStyle = hollowStrokeColor;
        ctx.lineWidth = 1;
        if (glitchHollow) {
          ctx.strokeStyle = glitchRed;
          ctx.strokeText(ch, cx - 1, lineY);
          ctx.strokeStyle = glitchCyan;
          ctx.strokeText(ch, cx + 1, lineY);
        }
        ctx.strokeStyle = hollowStrokeColor;
        ctx.strokeText(ch, cx, lineY);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = wallFill;
        ctx.shadowBlur = Math.round(14 * glowAlpha);
        ctx.shadowColor = hexWithAlpha(smartSilver, "44");
        if (glitchBold) {
          ctx.shadowOffsetX = -1;
        }
        ctx.fillText(ch, cx, lineY);
        ctx.restore();
      }
      cx += w;
    }
    x = cx + spaceW;
  }

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const g = ctx.createRadialGradient(
    designSize / 2,
    designSize / 2,
    0,
    designSize / 2,
    designSize / 2,
    designSize * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0.10)");
  g.addColorStop(0.2, "rgba(0,0,0,0.08)");
  g.addColorStop(0.45, "rgba(0,0,0,0.06)");
  g.addColorStop(0.7, "rgba(0,0,0,0.035)");
  g.addColorStop(1, "rgba(0,0,0,0.012)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, designSize, designSize);
  ctx.restore();
}

/**
 * 於離屏 canvas 繪製字牆，回傳 ImageBitmap 或 canvas（供旋轉／exclusion）。
 */
function renderTextWallToCanvas(input, designSize) {
  const c = document.createElement("canvas");
  c.width = designSize;
  c.height = designSize;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.clearRect(0, 0, designSize, designSize);

  drawTextWallLayer(ctx, input, designSize);

  const filtered = document.createElement("canvas");
  filtered.width = designSize;
  filtered.height = designSize;
  const fctx = filtered.getContext("2d");
  if (!fctx) return c;
  fctx.filter = "brightness(1.25) saturate(1.2) contrast(1.05)";
  fctx.drawImage(c, 0, 0);
  return filtered;
}

/**
 * @param {BattleReportCanvasInput} input
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateBattleReportCanvas(input) {
  await ensureDocumentFontsReady();
  const platform = Capacitor.getPlatform();

  /** 預載雜訊圖，供漸層後立即疊加（與後段 film grain 分層） */
  let noiseImgPreload = null;
  try {
    noiseImgPreload = await loadBattleReportImage(NOISE_DATA_URL, { platform });
  } catch {
    noiseImgPreload = null;
  }

  const D = BATTLE_CARD_DESIGN_SIZE;
  const OUT = BATTLE_CARD_EXPORT_SIZE;
  const scale = OUT / D;

  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[battleReportCanvas] 2d context unavailable");

  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { teamColors } = input;
  const { primary: tp, secondary: ts } = teamColors;

  const wallPrimaryGlow = hexWithAlpha(tp, "33");
  const wallSecondaryGlow = hexWithAlpha(ts, "26");
  const laserCutTint = mixHex(mixHex(tp, ts, 0.5), "#ffffff", 0.35);
  const laserCutColor = hexWithAlpha(laserCutTint, "E8");
  const reflectiveTint20 = hexWithAlpha(tp, "20");
  const reflectiveTint40 = hexWithAlpha(tp, "40");
  const reflectiveTint60 = hexWithAlpha(tp, "60");
  const reflectiveSecondaryTint20 = hexWithAlpha(ts, "20");
  const reflectiveSecondaryTint60 = hexWithAlpha(ts, "60");
  const reflectiveCoreCool = hexWithAlpha(
    mixHex(mixHex(tp, ts, 0.5), "#ffffff", 0.78),
    "D9",
  );

  const { r: pR, g: pG, b: pB } = hexToRgb(tp);
  const { r: sR, g: sG, b: sB } = hexToRgb(ts);
  const complementPrimary = rgbToHex(255 - pR, 255 - pG, 255 - pB);
  const complementSecondary = rgbToHex(255 - sR, 255 - sG, 255 - sB);
  const cornerTopRim = hexWithAlpha(mixHex(complementPrimary, tp, 0.35), "F0");
  const cornerBottomRim = hexWithAlpha(mixHex(complementSecondary, ts, 0.35), "F0");

  const radius = 16;

  /** CSS linear-gradient(angle)：0deg 向上；轉成 canvas 座標（0 向右） */
  const cssDegToRad = (deg) => ((90 - deg) * Math.PI) / 180;
  const deg115 = cssDegToRad(115);
  const cos115 = Math.cos(deg115);
  const sin115 = Math.sin(deg115);
  const bgGrad = ctx.createLinearGradient(
    D / 2 - cos115 * D,
    D / 2 - sin115 * D,
    D / 2 + cos115 * D,
    D / 2 + sin115 * D,
  );
  bgGrad.addColorStop(0, hexWithAlpha(tp, "FF"));
  bgGrad.addColorStop(0.45, hexWithAlpha(tp, "E6"));
  bgGrad.addColorStop(0.5, "rgba(0,0,0,0.8)");
  bgGrad.addColorStop(0.55, hexWithAlpha(ts, "E6"));
  bgGrad.addColorStop(1, hexWithAlpha(ts, "FF"));

  ctx.save();
  roundRectPath(ctx, 0, 0, D, D, radius);
  ctx.clip();

  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, D, D);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let sy = 0; sy < D; sy += 4) {
    ctx.beginPath();
    ctx.moveTo(0, sy + 0.5);
    ctx.lineTo(D, sy + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  if (noiseImgPreload) {
    const pat0 = ctx.createPattern(noiseImgPreload, "repeat");
    if (pat0) {
      ctx.fillStyle = pat0;
      ctx.globalAlpha = 0.26;
      ctx.fillRect(0, 0, D, D);
      ctx.globalAlpha = 1;
    }
  }

  const mixHalf = mixHex(tp, ts, 0.5);
  ctx.save();
  ctx.translate(D / 2, D / 2);
  ctx.rotate(deg115);
  ctx.fillStyle = hexWithAlpha(mixHalf, "12");
  for (let i = -80; i < 80; i += 1) {
    ctx.fillRect(i * 10, -D * 2, 1, D * 4);
  }
  ctx.restore();

  const rad1 = ctx.createRadialGradient(D * 0.5, D * 0.3, 0, D * 0.5, D * 0.3, D * 0.62);
  rad1.addColorStop(0, wallPrimaryGlow);
  rad1.addColorStop(1, "transparent");
  ctx.fillStyle = rad1;
  ctx.globalAlpha = 0.95;
  ctx.fillRect(0, 0, D, D);
  const rad2 = ctx.createRadialGradient(D, D, 0, D, D, D * 0.58);
  rad2.addColorStop(0, wallSecondaryGlow);
  rad2.addColorStop(1, "transparent");
  ctx.fillStyle = rad2;
  ctx.fillRect(0, 0, D, D);
  ctx.globalAlpha = 1;

  const wallCanvas = renderTextWallToCanvas(input, D);
  ctx.save();
  ctx.translate(D / 2, D / 2);
  ctx.rotate((-15 * Math.PI) / 180);
  ctx.translate(-D / 2, -D / 2);
  ctx.globalCompositeOperation = "exclusion";
  ctx.globalAlpha = 0.98;
  ctx.drawImage(wallCanvas, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(D / 2, D / 2);
  ctx.rotate(deg115);
  const laser = ctx.createLinearGradient(-D, 0, D, 0);
  laser.addColorStop(0, "transparent");
  laser.addColorStop(0.496, "transparent");
  laser.addColorStop(0.4975, hexWithAlpha(laserCutColor, "99"));
  laser.addColorStop(0.5, "#FFFFFF");
  laser.addColorStop(0.5025, hexWithAlpha(laserCutColor, "99"));
  laser.addColorStop(0.504, "transparent");
  laser.addColorStop(1, "transparent");
  ctx.fillStyle = laser;
  ctx.shadowColor = "#FFFFFF";
  ctx.shadowBlur = 18;
  ctx.globalAlpha = 0.82;
  ctx.fillRect(-D * 2, -D * 2, D * 4, D * 4);
  ctx.restore();
  ctx.globalAlpha = 1;

  const sweepGrad = ctx.createLinearGradient(0, -D * 0.1, D, D * 1.2);
  sweepGrad.addColorStop(0.18, "transparent");
  sweepGrad.addColorStop(0.22, reflectiveTint20);
  sweepGrad.addColorStop(0.24, reflectiveTint60);
  sweepGrad.addColorStop(0.26, reflectiveSecondaryTint20);
  sweepGrad.addColorStop(0.28, reflectiveSecondaryTint60);
  sweepGrad.addColorStop(0.29, reflectiveCoreCool);
  sweepGrad.addColorStop(0.31, reflectiveCoreCool);
  sweepGrad.addColorStop(0.33, reflectiveTint40);
  sweepGrad.addColorStop(0.45, "transparent");
  ctx.fillStyle = sweepGrad;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(0, 0, D, D);
  ctx.globalAlpha = 1;

  ctx.fillStyle = mixHex(tp, ts, 0.5);
  ctx.globalAlpha = 0.2;
  ctx.fillRect(0, 0, D, D);
  ctx.globalAlpha = 1;

  if (noiseImgPreload) {
    const pat1 = ctx.createPattern(noiseImgPreload, "repeat");
    if (pat1) {
      ctx.fillStyle = pat1;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(0, 0, D, D);
      ctx.globalAlpha = 1;
    }
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.02)";
  for (let gx = 0; gx < D; gx += 20) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, D);
    ctx.stroke();
  }
  for (let gy = 0; gy < D; gy += 20) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(D, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  roundRectPath(ctx, 0, 0, D, D, radius);
  ctx.stroke();
  ctx.shadowColor = hexWithAlpha(tp, "15");
  ctx.shadowBlur = 24;
  roundRectPath(ctx, 0, 0, D, D, radius);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  const stanceColor = input.stanceColor;
  const hudEdgeColor = hexWithAlpha(mixHex(ts, "#000000", 0.6), "D0");

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const titleBlockTop = TITLE_BLOCK_TOP;
  const subtitleY = titleBlockTop;
  const titleStartY = titleBlockTop + 14 + GAP_AFTER_SUBTITLE;
  ctx.save();
  const flare = ctx.createRadialGradient(D / 2, titleBlockTop + 32, 0, D / 2, titleBlockTop + 32, 64);
  flare.addColorStop(0, stanceColor);
  flare.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = flare;
  ctx.fillRect(D / 2 - 80, titleBlockTop, 160, 160);
  ctx.restore();

  ctx.font = `600 14px Inter, system-ui, sans-serif`;
  ctx.fillStyle = hexWithAlpha(stanceColor, "CC");
  ctx.shadowColor = hudEdgeColor;
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillText(input.battleSubtitle, D / 2, subtitleY);

  const titleBottomY = drawWrappedText(ctx, input.battleTitle, {
    maxWidth: MAX_BODY_TEXT_WIDTH,
    x: D / 2,
    y: titleStartY,
    fillStyle: stanceColor,
    isItalicTitle: input.isTitleUppercase,
    shadowBlur: 6,
    shadowColor: "rgba(0,0,0,0.28)",
  });
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  const idY = titleBottomY + GAP_AFTER_TITLE_BLOCK;
  const idH = 56;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRectPath(ctx, 20, idY, D - 40, idH, 12);
  ctx.fill();

  let avatarImg = null;
  if (input.photoURL) {
    try {
      avatarImg = await loadBattleReportImage(input.photoURL, { platform });
    } catch {
      avatarImg = null;
    }
  }

  const avX = 28;
  const avY = idY + 8;
  const avR = 20;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
  ctx.clip();
  if (avatarImg) {
    ctx.drawImage(avatarImg, avX, avY, avR * 2, avR * 2);
  } else {
    drawAvatarPlaceholderDisc(ctx, avX, avY, avR);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 14px Inter, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 2;
  ctx.fillText(input.displayName, avX + avR * 2 + 12, avY + 4);
  ctx.fillStyle = tp;
  ctx.fillText(input.teamLineText, avX + avR * 2 + 12, avY + 22);

  const stanceStr = String(input.stanceDisplayName || "GOAT").toUpperCase().trim() || "GOAT";
  const stanceLen = stanceStr.length;
  const long = stanceLen >= 11;
  const medium = stanceLen >= 8 && stanceLen <= 10;
  let line1 = stanceStr;
  let line2 = "";
  if (long) {
    const idx = stanceStr.indexOf(" ");
    if (idx > 0) {
      line1 = stanceStr.slice(0, idx);
      line2 = stanceStr.slice(idx + 1);
    }
  }
  let psPx = 120;
  if (medium) psPx = 95;
  if (long) psPx = 90;

  const psCenterY = idY + idH + GAP_ID_TO_POWER;
  drawPowerStanceNeon(ctx, D / 2, line1, line2, long, psCenterY, psPx, stanceColor, tp, ts);

  /** 字框底 + 霓虹 shadowBlur（最大約 40）視覺外擴，避免證詞與光暈黏在一起 */
  const PS_GLOW_PAD = 28;
  const powerBottom = estimatePowerStanceBottom(ctx, psPx, long, line2, line1, psCenterY) + PS_GLOW_PAD;

  const evidenceMaxBottom = evidenceMaxBottomY(D);
  const evidenceLineGap = Math.round(EVIDENCE_FONT_SIZE * 1.28);

  const reasonLabelsFiltered = (input.reasonLabels ?? [])
    .map((l) => String(l ?? "").trim())
    .filter(Boolean);
  if (reasonLabelsFiltered.length) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const labelY = powerBottom + 4;
    let yCursor = labelY + 14;
    const rawMaxLines = Math.floor((evidenceMaxBottom - yCursor) / evidenceLineGap);
    const maxLines = Math.min(EVIDENCE_BODY_MAX_LINES, Math.max(0, rawMaxLines));
    if (maxLines > 0) {
      ctx.font = "600 10px Inter, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.shadowBlur = 1;
      ctx.fillText(input.evidenceLabel, EVIDENCE_LEFT, labelY);
      ctx.shadowBlur = 0;

      let evidenceLines = layoutEvidenceTokenLines(
        ctx,
        reasonLabelsFiltered,
        stanceColor,
        MAX_BODY_TEXT_WIDTH,
      );
      if (evidenceLines.length > maxLines) {
        evidenceLines = evidenceLines.slice(0, maxLines);
      }
      ctx.font = `500 ${EVIDENCE_FONT_SIZE}px Inter, sans-serif`;
      for (const parts of evidenceLines) {
        let lx = EVIDENCE_LEFT;
        for (const part of parts) {
          ctx.fillStyle = part.color;
          ctx.fillText(part.text, lx, yCursor);
          lx += ctx.measureText(part.text).width;
        }
        yCursor += evidenceLineGap;
      }
    }
  }

  const footerY = designFooterFirstLineY(D);
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = tp;
  ctx.shadowBlur = 2;
  ctx.fillText(input.regionText, 24, footerY);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(input.rankLineText, 24, footerY + 16);

  let crownImg = null;
  try {
    crownImg = await loadBattleReportImage(
      typeof crownIcon === "string" ? crownIcon : crownIcon?.src ?? crownIcon,
      { platform },
    );
  } catch {
    crownImg = null;
  }
  const crownTop = footerY - 8;
  const crownSize = 56;
  const crownCenterY = crownTop + crownSize / 2;
  if (crownImg) {
    ctx.drawImage(crownImg, D - 120, crownTop, crownSize, crownSize);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "600 12px ui-serif, Georgia, serif";
  ctx.fillStyle = "#D4AF37";
  ctx.fillText(input.brandLine, D - 24, crownCenterY);
  ctx.textBaseline = "top";

  ctx.textAlign = "center";
  ctx.font = "6px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText(input.metaFooterLine, D / 2, D - FOOTER_META_LINE_FROM_BOTTOM);
  ctx.font = "8px Inter, sans-serif";
  ctx.fillText(input.disclaimerLine, D / 2, D - FOOTER_DISCLAIMER_FROM_BOTTOM);

  ctx.save();
  ctx.strokeStyle = cornerTopRim;
  ctx.lineWidth = 1;
  ctx.shadowColor = cornerTopRim;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(28, 8);
  ctx.moveTo(8, 8);
  ctx.lineTo(8, 28);
  ctx.moveTo(D - 8, 8);
  ctx.lineTo(D - 28, 8);
  ctx.moveTo(D - 8, 8);
  ctx.lineTo(D - 8, 28);
  ctx.stroke();
  ctx.strokeStyle = cornerBottomRim;
  ctx.shadowColor = cornerBottomRim;
  ctx.beginPath();
  ctx.moveTo(8, D - 8);
  ctx.lineTo(28, D - 8);
  ctx.moveTo(8, D - 8);
  ctx.lineTo(8, D - 28);
  ctx.moveTo(D - 8, D - 8);
  ctx.lineTo(D - 28, D - 8);
  ctx.moveTo(D - 8, D - 8);
  ctx.lineTo(D - 8, D - 28);
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const snapCtx = snapshot.getContext("2d");
  if (!snapCtx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }
  snapCtx.drawImage(canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "saturate(1.4) contrast(1.1) brightness(1.05)";
  ctx.drawImage(snapshot, 0, 0);
  ctx.filter = "none";

  return canvas;
}

/**
 * @param {BattleReportCanvasInput} input
 * @returns {Promise<string>} data URL (PNG)
 */
export async function generateBattleReportPngDataUrl(input) {
  const canvas = await generateBattleReportCanvas(input);
  return canvas.toDataURL("image/png", 1.0);
}
