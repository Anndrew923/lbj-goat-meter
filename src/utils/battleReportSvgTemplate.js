import { hexWithAlpha } from "./colorUtils.js";
import { mixHex } from "./battleCardVisualMath.js";
import {
  BATTLE_CARD_EXPORT_SCALE,
  buildWallWordSpecs,
  getPowerStanceModel,
} from "./battleCardMirrorShared.js";
import { applySvgExportAccentHex, applySvgExportTeamColors } from "./battleCardExportColors.js";

/**
 * 【架構決策紀錄 - 2026-04-01】
 * 1. 核心路徑：全面採用 SVG 模板渲染。嚴禁回切至 DOM 截圖或 html-to-image。
 * 2. 佈局原則：所有 Y 軸座標必須為「動態累加」，不准使用 Fixed Magic Numbers，
 * 以支援多行標題、變動字數與全球語系適配。
 * 3. 色彩標準：採用 Overdrive Map 鎖死 "#FF0000" 與 "#BF57FF"，
 * 確保 1920px 導出圖片發色超越 UI 預覽。
 */
const CANVAS_SIZE = 1080;
const TITLE_MAX_CHARS_PER_LINE = 22;
const TITLE_MAX_LINES = 4;
const EVIDENCE_MAX_CHARS_PER_LINE = 58;
const EVIDENCE_MAX_LINES = 8;

/**
 * Tailwind 映射常數（1:1）：
 * - p-6 = 24px
 * - gap-1 = 4px
 * - h-16 = 64px
 * - h-20 = 80px
 * 此處先以 640 設計稿推導，再等比放大至 1080。
 */
const SCALE = BATTLE_CARD_EXPORT_SCALE;
const P6 = Math.round(24 * SCALE);
const GAP_1 = Math.round(4 * SCALE);
const H_16 = Math.round(64 * SCALE);
const H_20 = Math.round(80 * SCALE);

/** 身份列隊伍／城市列（teamLineText）基線 */
const TEAM_AFFILIATION_LINE_OFFSET_Y = Math.round(47 * SCALE);

const TOP_SUBTITLE_FONT_SIZE = Math.round(14 * SCALE);
const TOP_TITLE_FONT_SIZE = Math.round(56 * SCALE);
const CONTENT_GAP = Math.round(32 * SCALE);

const FOOTER_META_FONT_SIZE = Math.round(6 * SCALE);
const FOOTER_DISCLAIMER_FONT_SIZE = Math.round(8 * SCALE);

const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

function escapeXml(input) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function breakLineByChars(text, maxChars, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  const unitLimit = maxChars;
  const charUnits = (ch) => {
    if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(ch)) return 2;
    if (/[A-Z0-9]/.test(ch)) return 1.08;
    return 1;
  };
  const textUnits = (txt) => Array.from(txt).reduce((sum, ch) => sum + charUnits(ch), 0);
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textUnits(candidate) <= unitLimit) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (textUnits(word) <= unitLimit) {
      line = word;
    } else {
      let cut = "";
      for (const ch of Array.from(word)) {
        if (textUnits(`${cut}${ch}…`) > unitLimit) break;
        cut += ch;
      }
      line = `${cut || word.slice(0, 1)}…`;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}

function buildEvidenceLines(reasonLabels) {
  const merged = (reasonLabels ?? []).map((v) => String(v ?? "").trim()).filter(Boolean).join(" / ");
  return breakLineByChars(merged, EVIDENCE_MAX_CHARS_PER_LINE, EVIDENCE_MAX_LINES);
}

function buildLaserLineByRotate(deg, centerX, centerY, length) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad) * (length / 2);
  const dy = Math.sin(rad) * (length / 2);
  return {
    x1: centerX - dx,
    y1: centerY - dy,
    x2: centerX + dx,
    y2: centerY + dy,
  };
}

function buildWatermarkTextWall({ wallText, battleTitle, teamColors }) {
  const specs = buildWallWordSpecs({ wallText, battleTitle, teamColors });
  const rowCount = 15;
  const colCount = 10;
  const startX = -Math.round(140 * SCALE);
  const startY = Math.round(100 * SCALE);
  const colStep = Math.round(118 * SCALE);
  const rowStep = Math.round(58 * SCALE);
  const smartSilver = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#e6e6e6", 0.55);
  const hollowStrokeColor = hexWithAlpha(smartSilver, "FF");
  return specs
    .map((spec) => {
      const row = Math.floor(spec.id / colCount) % rowCount;
      const col = spec.id % colCount;
      const x = startX + col * colStep + (row % 2 === 0 ? 0 : Math.round(34 * SCALE));
      const y = startY + row * rowStep;
      const alpha = (0.2 + spec.glowAlpha * 0.16).toFixed(3);
      const weight = spec.isBlackWeight ? 900 : 200;
      const letters = spec.text
        .split("")
        .map((ch, idx) => {
          const blockStart = Math.floor(idx / 5) * 5;
          const isHollow = (spec.id + blockStart) % 3 === idx % 5;
          return isHollow
            ? `<tspan fill="transparent" stroke="${hollowStrokeColor}" stroke-width="1" style="paint-order:stroke">${escapeXml(ch)}</tspan>`
            : `<tspan fill="${smartSilver}">${escapeXml(ch)}</tspan>`;
        })
        .join("");
      const triple = `${letters}<tspan> </tspan>${letters}<tspan> </tspan>${letters}`;
      return `<text x="${x}" y="${y}" fill-opacity="${alpha}" font-size="${Math.round(spec.sizePx * SCALE)}" font-style="italic" font-weight="${weight}" style="letter-spacing: 0.03em;">${triple}</text>`;
    })
    .join("");
}

/**
 * SVG 戰報模板：以宣告式圖層描述取代指令式 Canvas，確保可維護與可測試。
 */
export function buildBattleReportSvg(input, assets) {
  const teamColors = applySvgExportTeamColors(input.teamColors ?? { primary: "#7A0026", secondary: "#3A0CA3" });
  const stanceColor = applySvgExportAccentHex(input.stanceColor ?? "#D4AF37");
  const bgMidSolid = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#000000", 0.35);
  const titleLines = breakLineByChars(input.battleTitle, TITLE_MAX_CHARS_PER_LINE, TITLE_MAX_LINES);
  const evidenceLines = buildEvidenceLines(input.reasonLabels);
  const wallMarkup = buildWatermarkTextWall({
    wallText: input.wallText,
    battleTitle: input.battleTitle,
    teamColors,
  });
  const wallChromeSpray = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#c4c4d2", 0.38);
  const wallOverlayBed = mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.48), "#121212", 0.62);
  const CONTENT_PX = Math.round(20 * SCALE); // DOM p-5
  const subtitleY = CONTENT_PX + TOP_SUBTITLE_FONT_SIZE;
  const titleStep = Math.round(40 * SCALE);
  // 對齊 BattleCard 的 flex-col + gap-1：額外補償 subtitle line-height 尾端空間，避免標題壓線。
  const subtitleLineHeight = Math.round(20 * SCALE);
  const subtitleOverflowCompensation = Math.max(0, subtitleLineHeight - TOP_SUBTITLE_FONT_SIZE);
  const titleY = subtitleY + TOP_SUBTITLE_FONT_SIZE + subtitleOverflowCompensation + GAP_1;
  /** 稱號＋戰報主標整體下移 20px，撐開頂部標題區（對應 stanceNameY 335 級距） */
  const STANCE_TITLE_STACK_SHIFT_Y = 20;
  const subtitleYDraw = subtitleY + STANCE_TITLE_STACK_SHIFT_Y;
  const titleYDraw = titleY + STANCE_TITLE_STACK_SHIFT_Y;
  const titleBottomY = titleYDraw + Math.max(0, titleLines.length - 1) * titleStep + TOP_TITLE_FONT_SIZE;

  // [CSO Decision] Ensure no overlap on multi-line titles.
  const displayNameY = titleBottomY + CONTENT_GAP;
  // 身份框緊接在姓名列之後，形成完整垂直流動計算。
  const idY = displayNameY + Math.round(16 * SCALE);
  const idTextX = CONTENT_PX + Math.round(76 * SCALE);
  const idAvatarSize = Math.round(48 * SCALE);
  const idAvatarX = CONTENT_PX + Math.round(8 * SCALE);
  const idAvatarY = idY + Math.round((H_16 - idAvatarSize) / 2);

  const idHeaderCrownSize = Math.round(48 * SCALE);
  const idHeaderCrownX = CANVAS_SIZE / 2 - idHeaderCrownSize / 2;
  const idHeaderCrownY = idY - idHeaderCrownSize - Math.round(8 * SCALE);

  const powerY = idY + H_16 + CONTENT_GAP;
  const powerH = Math.round(170 * SCALE);
  const powerStanceModel = getPowerStanceModel(input.stanceDisplayName);
  const powerTextY = powerY + Math.round(96 * SCALE);

  const evidenceY = powerY + powerH + CONTENT_GAP;
  const evidenceLine1Y = evidenceY + Math.round(22 * SCALE);
  const evidenceLine2Y = evidenceLine1Y + Math.round(24 * SCALE);

  const footerY = CANVAS_SIZE - CONTENT_PX - H_20;
  const footerBaselineY = footerY + Math.round(30 * SCALE);
  const footerRankY = footerBaselineY + Math.round(14 * SCALE);
  const crownSize = Math.round(40 * SCALE);
  const crownX = CANVAS_SIZE - CONTENT_PX - crownSize - Math.round(150 * SCALE);
  const crownY = footerY + Math.round((H_20 - crownSize) / 2);
  const crownCenterY = crownY + crownSize / 2;
  const brandTextX = CANVAS_SIZE - P6;

  const metaBaseY = CANVAS_SIZE - P6 - Math.round(14 * SCALE);
  const laserMain = buildLaserLineByRotate(-15, CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE * 2);
  const laserSecondary = {
    x1: laserMain.x1 + Math.cos((-15 * Math.PI) / 180) * Math.round(10 * SCALE),
    y1: laserMain.y1 + Math.sin((-15 * Math.PI) / 180) * Math.round(10 * SCALE),
    x2: laserMain.x2 + Math.cos((-15 * Math.PI) / 180) * Math.round(10 * SCALE),
    y2: laserMain.y2 + Math.sin((-15 * Math.PI) / 180) * Math.round(10 * SCALE),
  };

  const brandLine = escapeXml(input.brandLine);
  const regionLine = escapeXml(input.regionText || "");
  const rankLine = escapeXml(input.rankLineText || "");
  const evidenceInlineTextPrimary = escapeXml(evidenceLines[0] || "-");
  const evidenceInlineTextSecondary = escapeXml(evidenceLines[1] || "");
  const hasEvidence = evidenceLines.length > 0;

  const titleMarkup = titleLines
    .map(
      (line, idx) =>
        `<text x="${CANVAS_SIZE / 2}" y="${titleYDraw + idx * titleStep}" text-anchor="middle" fill="${stanceColor}" font-size="${TOP_TITLE_FONT_SIZE}" font-style="${input.isTitleUppercase ? "italic" : "normal"}" font-weight="900" filter="url(#fx-neon-overdrive)" style="letter-spacing: 0.03em;">${escapeXml(line)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" text-rendering="geometricPrecision">
    <defs>
      <style>
        text { text-rendering: geometricPrecision; letter-spacing: 0.03em; }
      </style>
      <linearGradient id="bg-grad" x1="0%" y1="0%" x2="42.3%" y2="90.6%">
        <stop offset="0%" stop-color="${hexWithAlpha(teamColors.primary, "FF")}" />
        <stop offset="45%" stop-color="${hexWithAlpha(teamColors.primary, "E6")}" />
        <stop offset="50%" stop-color="${bgMidSolid}" />
        <stop offset="55%" stop-color="${hexWithAlpha(teamColors.secondary, "E6")}" />
        <stop offset="100%" stop-color="${hexWithAlpha(teamColors.secondary, "FF")}" />
      </linearGradient>
      <radialGradient id="center-glow" cx="52%" cy="55%" r="58%">
        <stop offset="0%" stop-color="${hexWithAlpha(stanceColor, "36")}" />
        <stop offset="42%" stop-color="${hexWithAlpha(teamColors.primary, "1C")}" />
        <stop offset="100%" stop-color="transparent" />
      </radialGradient>
      <linearGradient id="reflective-sweep" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="18%" stop-color="transparent" />
        <stop offset="22%" stop-color="${hexWithAlpha(teamColors.primary, "20")}" />
        <stop offset="24%" stop-color="${hexWithAlpha(teamColors.primary, "60")}" />
        <stop offset="26%" stop-color="${hexWithAlpha(teamColors.secondary, "20")}" />
        <stop offset="28%" stop-color="${hexWithAlpha(teamColors.secondary, "60")}" />
        <stop offset="29%" stop-color="${hexWithAlpha(mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.78), "D9")}" />
        <stop offset="31%" stop-color="${hexWithAlpha(mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.78), "D9")}" />
        <stop offset="33%" stop-color="${hexWithAlpha(teamColors.primary, "40")}" />
        <stop offset="45%" stop-color="transparent" />
      </linearGradient>
      <linearGradient id="reflective-sweep-145" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(145 0.5 0.5)">
        <stop offset="18%" stop-color="transparent" />
        <stop offset="22%" stop-color="${hexWithAlpha(teamColors.primary, "22")}" />
        <stop offset="24%" stop-color="${hexWithAlpha(teamColors.primary, "55")}" />
        <stop offset="26%" stop-color="${hexWithAlpha(teamColors.secondary, "22")}" />
        <stop offset="28%" stop-color="${hexWithAlpha(teamColors.secondary, "55")}" />
        <stop offset="29%" stop-color="${hexWithAlpha(mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.82), "CC")}" />
        <stop offset="31%" stop-color="${hexWithAlpha(mixHex(mixHex(teamColors.primary, teamColors.secondary, 0.5), "#ffffff", 0.82), "CC")}" />
        <stop offset="33%" stop-color="${hexWithAlpha(teamColors.primary, "38")}" />
        <stop offset="45%" stop-color="transparent" />
      </linearGradient>
      <linearGradient id="laser-core" gradientUnits="userSpaceOnUse" x1="${laserMain.x1}" y1="${laserMain.y1}" x2="${laserMain.x2}" y2="${laserMain.y2}">
        <stop offset="0%" stop-color="transparent" />
        <stop offset="46%" stop-color="transparent" />
        <stop offset="49.6%" stop-color="${hexWithAlpha(stanceColor, "66")}" />
        <stop offset="50%" stop-color="#FFFFFF" />
        <stop offset="50.4%" stop-color="${hexWithAlpha(stanceColor, "66")}" />
        <stop offset="54%" stop-color="transparent" />
        <stop offset="100%" stop-color="transparent" />
      </linearGradient>

      <filter id="fx-neon-overdrive" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur3" />
        <feMerge>
          <feMergeNode in="blur3" />
          <feMergeNode in="blur2" />
          <feMergeNode in="blur1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <filter id="wall-chrome-overlay" x="-22%" y="-22%" width="144%" height="144%" color-interpolation-filters="sRGB">
        <feFlood flood-color="${wallChromeSpray}" flood-opacity="0.22" result="spray" />
        <feBlend in="SourceGraphic" in2="spray" mode="overlay" result="step1" />
        <feFlood flood-color="${wallOverlayBed}" flood-opacity="0.52" result="bed" />
        <feBlend in="step1" in2="bed" mode="overlay" />
      </filter>

      <filter id="export-fe-turbulence-noise" x="0" y="0" width="1080" height="1080" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.065" numOctaves="4" seed="11" stitchTiles="stitch" result="raw" />
        <feColorMatrix in="raw" type="luminanceToAlpha" result="mask" />
        <feFlood flood-color="#f2f2f4" flood-opacity="1" result="base" />
        <feComposite in="base" in2="mask" operator="in" result="grain" />
      </filter>

      <pattern id="noise-pattern" patternUnits="userSpaceOnUse" width="180" height="180">
        <image href="${NOISE_DATA_URL}" x="0" y="0" width="180" height="180" />
      </pattern>

      <clipPath id="avatar-clip">
        <circle cx="${idAvatarX + idAvatarSize / 2}" cy="${idAvatarY + idAvatarSize / 2}" r="${idAvatarSize / 2}" />
      </clipPath>
    </defs>

    <g>
    <rect width="1080" height="1080" fill="url(#bg-grad)" />
    <rect width="1080" height="1080" fill="url(#center-glow)" />
    <rect x="0" y="-108" width="1080" height="1296" fill="url(#reflective-sweep)" opacity="0.9" />
    <rect x="0" y="-108" width="1080" height="1296" fill="url(#reflective-sweep-145)" opacity="0.78" style="mix-blend-mode: screen;" />
    <rect width="1080" height="1080" fill="url(#noise-pattern)" opacity="0.06" />
    <rect width="1080" height="1080" filter="url(#export-fe-turbulence-noise)" opacity="0.08" />
    ${
      assets.colorWash
        ? `<image href="${escapeXml(assets.colorWash)}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="none" opacity="0.2" style="filter: saturate(1.25);" />`
        : `<rect width="1080" height="1080" fill="${mixHex(teamColors.primary, teamColors.secondary, 0.5)}" fill-opacity="0.2" style="filter: saturate(1.25);" />`
    }
    ${Array.from({ length: 54 })
      .map((_, i) => `<line x1="0" y1="${i * 20}" x2="1080" y2="${i * 20}" stroke="rgba(255,255,255,0.02)" stroke-width="1" />`)
      .join("")}
    ${Array.from({ length: 54 })
      .map((_, i) => `<line x1="${i * 20}" y1="0" x2="${i * 20}" y2="1080" stroke="rgba(255,255,255,0.02)" stroke-width="1" />`)
      .join("")}
    ${Array.from({ length: 155 })
      .map((_, i) => `<line x1="0" y1="${i * 7}" x2="1080" y2="${i * 7}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`)
      .join("")}
    <g transform="rotate(-15 ${CANVAS_SIZE / 2} ${CANVAS_SIZE / 2})" filter="url(#wall-chrome-overlay)" opacity="0.94">
      ${wallMarkup}
    </g>
    <rect width="1080" height="1080" fill="url(#laser-core)" opacity="0.82" />
    <line x1="${laserMain.x1}" y1="${laserMain.y1}" x2="${laserMain.x2}" y2="${laserMain.y2}" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="3" />
    <line x1="${laserSecondary.x1}" y1="${laserSecondary.y1}" x2="${laserSecondary.x2}" y2="${laserSecondary.y2}" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="12" />

    <text x="${CANVAS_SIZE / 2}" y="${subtitleYDraw}" text-anchor="middle" fill="${hexWithAlpha(stanceColor, "CC")}" font-size="${TOP_SUBTITLE_FONT_SIZE}" font-weight="700" style="letter-spacing: 0.03em;">${escapeXml(input.battleSubtitle)}</text>
    ${titleMarkup}
    <image href="${assets.crownDataUri}" x="${idHeaderCrownX}" y="${idHeaderCrownY}" width="${idHeaderCrownSize}" height="${idHeaderCrownSize}" preserveAspectRatio="xMidYMid meet" />

    <rect x="${CONTENT_PX}" y="${idY}" width="${CANVAS_SIZE - CONTENT_PX * 2}" height="${H_16}" rx="18" fill="rgba(0,0,0,0.45)" />
    <image href="${assets.avatarDataUri}" x="${idAvatarX}" y="${idAvatarY}" width="${idAvatarSize}" height="${idAvatarSize}" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice" />
    <circle cx="${idAvatarX + idAvatarSize / 2}" cy="${idAvatarY + idAvatarSize / 2}" r="${idAvatarSize / 2}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" />
    <text x="${idTextX}" y="${displayNameY}" fill="#FFFFFF" font-size="${Math.round(14 * SCALE)}" font-weight="700" style="letter-spacing: 0.03em;">${escapeXml(input.displayName)}</text>
    <text x="${idTextX}" y="${idY + TEAM_AFFILIATION_LINE_OFFSET_Y}" fill="${teamColors.primary}" font-size="${Math.round(14 * SCALE)}" font-weight="700" style="letter-spacing: 0.03em;">${escapeXml(input.teamLineText)}</text>

    <rect x="${P6 - Math.round(16 * SCALE)}" y="${powerY}" width="${CANVAS_SIZE - (P6 - Math.round(16 * SCALE)) * 2}" height="${powerH}" rx="32" fill="rgba(0,0,0,0.75)" />
    ${
      powerStanceModel.isMultiLine
        ? `<text x="${CANVAS_SIZE / 2}" y="${powerTextY}" text-anchor="middle" fill="${stanceColor}" font-size="${Math.round(powerStanceModel.svgFontPx * SCALE)}" font-weight="900" font-style="italic" filter="url(#fx-neon-overdrive)" style="letter-spacing: 0.03em;">${escapeXml(powerStanceModel.line1)}</text>
    ${powerStanceModel.line2 ? `<text x="${CANVAS_SIZE / 2}" y="${powerTextY + Math.round(powerStanceModel.svgLineHeightPx * SCALE)}" text-anchor="middle" fill="${stanceColor}" font-size="${Math.round(powerStanceModel.svgFontPx * SCALE)}" font-weight="900" font-style="italic" filter="url(#fx-neon-overdrive)" style="letter-spacing: 0.03em;">${escapeXml(powerStanceModel.line2)}</text>` : ""}`
        : `<text x="${CANVAS_SIZE / 2}" y="${powerTextY}" text-anchor="middle" fill="${stanceColor}" font-size="${Math.round(powerStanceModel.svgFontPx * SCALE)}" font-weight="900" font-style="italic" filter="url(#fx-neon-overdrive)" style="letter-spacing: 0.03em;">${escapeXml(powerStanceModel.line1)}</text>`
    }

    ${
      hasEvidence
        ? `<rect x="${CONTENT_PX}" y="${evidenceY}" width="${CANVAS_SIZE - CONTENT_PX * 2}" height="${H_20}" rx="12" fill="rgba(10,10,12,0.88)" />
    <text x="${CONTENT_PX + Math.round(12 * SCALE)}" y="${evidenceY + Math.round(16 * SCALE)}" fill="rgba(255,255,255,0.62)" font-size="${Math.round(10 * SCALE)}" font-weight="600" style="letter-spacing: 0.03em;">${escapeXml(input.evidenceLabel || "裁決證明：")}</text>
    <text x="${CONTENT_PX + Math.round(12 * SCALE)}" y="${evidenceLine1Y}" fill="${hexWithAlpha(stanceColor, "E8")}" font-size="${Math.round(13 * SCALE)}" font-weight="600" style="letter-spacing: 0.03em;">${evidenceInlineTextPrimary}</text>
    ${evidenceInlineTextSecondary ? `<text x="${CONTENT_PX + Math.round(12 * SCALE)}" y="${evidenceLine2Y}" fill="${hexWithAlpha(stanceColor, "D4")}" font-size="${Math.round(12 * SCALE)}" font-weight="600" style="letter-spacing: 0.03em;">${evidenceInlineTextSecondary}</text>` : ""}`
        : ""
    }

    <line x1="${CONTENT_PX}" y1="${footerY - Math.round(8 * SCALE)}" x2="${CANVAS_SIZE - CONTENT_PX}" y2="${footerY - Math.round(8 * SCALE)}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
    <text x="${CONTENT_PX}" y="${footerBaselineY}" fill="${teamColors.primary}" font-size="${Math.round(12 * SCALE)}" font-weight="700" style="letter-spacing: 0.03em;">${regionLine}</text>
    <text x="${CONTENT_PX}" y="${footerRankY}" fill="rgba(255,255,255,0.85)" font-size="${Math.round(12 * SCALE)}" font-weight="500" style="letter-spacing: 0.03em;">${rankLine}</text>

    <image href="${assets.crownDataUri}" x="${crownX}" y="${crownY}" width="${crownSize}" height="${crownSize}" preserveAspectRatio="xMidYMid meet" />
    <text x="${brandTextX}" y="${crownCenterY}" dominant-baseline="middle" text-anchor="end" fill="${stanceColor}" font-size="${Math.round(12 * SCALE)}" font-weight="700" style="letter-spacing: 0.03em;">${brandLine || "The GOAT Meter"}</text>
    <g opacity="0.88">
      <line x1="0" y1="0" x2="${Math.round(34 * SCALE)}" y2="0" stroke="${hexWithAlpha(teamColors.primary, "F0")}" stroke-width="1" />
      <line x1="0" y1="0" x2="0" y2="${Math.round(34 * SCALE)}" stroke="${hexWithAlpha(teamColors.primary, "F0")}" stroke-width="1" />
      <line x1="${CANVAS_SIZE}" y1="0" x2="${CANVAS_SIZE - Math.round(34 * SCALE)}" y2="0" stroke="${hexWithAlpha(teamColors.primary, "F0")}" stroke-width="1" />
      <line x1="${CANVAS_SIZE}" y1="0" x2="${CANVAS_SIZE}" y2="${Math.round(34 * SCALE)}" stroke="${hexWithAlpha(teamColors.primary, "F0")}" stroke-width="1" />
      <line x1="0" y1="${CANVAS_SIZE}" x2="${Math.round(34 * SCALE)}" y2="${CANVAS_SIZE}" stroke="${hexWithAlpha(teamColors.secondary, "F0")}" stroke-width="1" />
      <line x1="0" y1="${CANVAS_SIZE}" x2="0" y2="${CANVAS_SIZE - Math.round(34 * SCALE)}" stroke="${hexWithAlpha(teamColors.secondary, "F0")}" stroke-width="1" />
      <line x1="${CANVAS_SIZE}" y1="${CANVAS_SIZE}" x2="${CANVAS_SIZE - Math.round(34 * SCALE)}" y2="${CANVAS_SIZE}" stroke="${hexWithAlpha(teamColors.secondary, "F0")}" stroke-width="1" />
      <line x1="${CANVAS_SIZE}" y1="${CANVAS_SIZE}" x2="${CANVAS_SIZE}" y2="${CANVAS_SIZE - Math.round(34 * SCALE)}" stroke="${hexWithAlpha(teamColors.secondary, "F0")}" stroke-width="1" />
    </g>

    <text x="${CANVAS_SIZE / 2}" y="${metaBaseY}" text-anchor="middle" fill="rgba(255,255,255,0.58)" font-size="${FOOTER_META_FONT_SIZE}" style="letter-spacing: 0.03em;">${escapeXml(input.metaFooterLine)}</text>
    <text x="${CANVAS_SIZE / 2}" y="${metaBaseY + Math.round(12 * SCALE)}" text-anchor="middle" fill="rgba(255,255,255,0.64)" font-size="${FOOTER_DISCLAIMER_FONT_SIZE}" style="letter-spacing: 0.03em;">${escapeXml(input.disclaimerLine)}</text>
    </g>
  </svg>`;
}
