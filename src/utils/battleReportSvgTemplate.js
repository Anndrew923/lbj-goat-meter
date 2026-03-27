import { hexWithAlpha } from "./colorUtils.js";
import { mixHex } from "./battleCardVisualMath.js";

const CANVAS_SIZE = 1080;
const TITLE_MAX_CHARS_PER_LINE = 22;
const TITLE_MAX_LINES = 4;
const EVIDENCE_MAX_CHARS_PER_LINE = 58;
const EVIDENCE_MAX_LINES = 8;
const BASE_TITLE_LINE_STEP = 66;
const BASE_ID_BLOCK_Y = 328;
const GAP_ID_TO_POWER_COMPRESSED = 10;
const UNIVERSAL_LAYOUT_COMPRESS_RATIO = 0.6;
const CANVAS_BASELINE = 1080;
const FOOTER_ANCHOR_TOP_Y = 826;
const FOOTER_META_OFFSET_Y = 42;
const FOOTER_DISCLAIMER_OFFSET_Y = 26;
const LASER_MAIN_LINE = { x1: -100, y1: 700, x2: 1200, y2: 300 };
const LASER_SECONDARY_OFFSET_Y = -60;
const WATERMARK_LAYER_ALPHA = 0.2;
const WATERMARK_BASE_OPACITY = 0.2;

export const BATTLE_REPORT_VISUAL_PRESETS = {
  standard: {
    neonMode: "single",
    neonStdA: 2,
    neonStdB: 2,
    exclusionAlpha: 0.6,
    titleGapScale: 1,
    idGapScale: 1,
    globalSaturate: 1,
    globalContrast: 1,
  },
  warzone: {
    neonMode: "dual",
    neonStdA: 4,
    neonStdB: 8,
    exclusionAlpha: 0.98,
    titleGapScale: 0.75,
    idGapScale: 0.75,
    globalSaturate: 1.5,
    globalContrast: 1.2,
  },
  overdrive: {
    neonMode: "single",
    neonStdA: 12,
    neonStdB: 12,
    exclusionAlpha: 1,
    titleGapScale: 0.6,
    idGapScale: 0.6,
    globalSaturate: 1.65,
    globalContrast: 1.28,
  },
};

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

function buildWatermarkTextWall(stanceDisplayName, teamColors) {
  const primaryWord = escapeXml(String(stanceDisplayName || "GOAT").toUpperCase());
  const fallbackTeamWord = escapeXml(String(teamColors.primary || "").slice(1, 4).toUpperCase() || "LAL");
  const watermarkColor = hexWithAlpha(mixHex(teamColors.primary, "#17050A", 0.88), "FF");
  const rows = [
    { y: 292, size: 96, opacity: 0.11, word: fallbackTeamWord, x: 0 },
    { y: 406, size: 112, opacity: 0.15, word: primaryWord, x: 180 },
    { y: 520, size: 86, opacity: 0.1, word: fallbackTeamWord, x: -14 },
    { y: 634, size: 108, opacity: 0.14, word: primaryWord, x: 96 },
    { y: 758, size: 90, opacity: 0.1, word: fallbackTeamWord, x: 16 },
    { y: 882, size: 124, opacity: 0.15, word: primaryWord, x: 162 },
    { y: 1012, size: 94, opacity: 0.1, word: fallbackTeamWord, x: 28 },
  ];
  return rows
    .map(
      (row) =>
        `<text x="${row.x}" y="${row.y}" fill="${watermarkColor}" fill-opacity="${(row.opacity * WATERMARK_BASE_OPACITY).toFixed(3)}" font-size="${row.size}" font-style="italic" font-weight="800" letter-spacing="2">${row.word}${row.word}${row.word}</text>`,
    )
    .join("");
}

/**
 * SVG 戰報模板：以宣告式圖層描述取代指令式 Canvas，確保可維護與可測試。
 */
export function buildBattleReportSvg(input, assets) {
  const presetKey = String(input.visualPreset || "overdrive");
  const preset = BATTLE_REPORT_VISUAL_PRESETS[presetKey] ?? BATTLE_REPORT_VISUAL_PRESETS.overdrive;
  const teamColors = input.teamColors ?? { primary: "#7A0026", secondary: "#3A0CA3" };
  const stanceColor = input.stanceColor ?? "#D4AF37";
  const titleLines = breakLineByChars(input.battleTitle, TITLE_MAX_CHARS_PER_LINE, TITLE_MAX_LINES);
  const evidenceLines = buildEvidenceLines(input.reasonLabels);
  const stanceLine = escapeXml(String(input.stanceDisplayName || "GOAT").toUpperCase());
  const wallMarkup = buildWatermarkTextWall(input.stanceDisplayName, teamColors);
  const titleStep = Math.round(48 * UNIVERSAL_LAYOUT_COMPRESS_RATIO);
  const compactIdY = Math.round(BASE_ID_BLOCK_Y - 140 - BASE_TITLE_LINE_STEP * (1 - UNIVERSAL_LAYOUT_COMPRESS_RATIO));
  const titleStartY = 68;
  const titleBottomY = titleStartY + Math.max(titleLines.length - 1, 0) * titleStep + 52;
  const idY = Math.max(compactIdY, titleBottomY + 14);
  const goatBarY = idY + 112 + GAP_ID_TO_POWER_COMPRESSED;
  const goatBarH = 196;
  const powerY = goatBarY + 134;
  const evidenceBarY = goatBarY + goatBarH + 14;
  const evidenceBarH = 92;
  const evidenceStartY = evidenceBarY + 58;
  const idTextX = 162;
  const footerTopY = Math.min(FOOTER_ANCHOR_TOP_Y, CANVAS_BASELINE - 254);
  const crownSize = 112;
  const crownX = 820;
  const crownY = footerTopY + 2;
  const crownCenterY = crownY + crownSize / 2;
  const metaBaseY = footerTopY + FOOTER_META_OFFSET_Y;
  const brandLine = escapeXml(input.brandLine);
  const evidenceInlineTextPrimary = escapeXml(evidenceLines[0] || "-");
  const evidenceInlineTextSecondary = escapeXml(evidenceLines[1] || "");

  const titleMarkup = titleLines
    .map(
      (line, idx) =>
        `<text x="540" y="${titleStartY + idx * titleStep}" text-anchor="middle" fill="${stanceColor}" font-size="56" font-style="${input.isTitleUppercase ? "italic" : "normal"}" font-weight="900" filter="url(#fx-neon)" text-rendering="geometricPrecision">${escapeXml(line)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" text-rendering="geometricPrecision">
    <defs>
      <style>
        text { text-rendering: geometricPrecision; }
      </style>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${hexWithAlpha(teamColors.primary, "FF")}" />
        <stop offset="40%" stop-color="${hexWithAlpha(teamColors.primary, "EA")}" />
        <stop offset="58%" stop-color="#2A0C18" />
        <stop offset="100%" stop-color="#1A0A12" />
      </linearGradient>
      <radialGradient id="center-glow" cx="52%" cy="55%" r="58%">
        <stop offset="0%" stop-color="${hexWithAlpha(stanceColor, "36")}" />
        <stop offset="42%" stop-color="${hexWithAlpha(teamColors.primary, "1C")}" />
        <stop offset="100%" stop-color="transparent" />
      </radialGradient>
      <linearGradient id="laser-core" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="transparent" />
        <stop offset="46%" stop-color="transparent" />
        <stop offset="49.6%" stop-color="${hexWithAlpha(stanceColor, "66")}" />
        <stop offset="50%" stop-color="#FFFFFF" />
        <stop offset="50.4%" stop-color="${hexWithAlpha(stanceColor, "66")}" />
        <stop offset="54%" stop-color="transparent" />
        <stop offset="100%" stop-color="transparent" />
      </linearGradient>

      <filter id="fx-neon" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${preset.neonStdA}" result="blurA" />
        <feColorMatrix
          in="blurA"
          type="matrix"
          values="1.12 0 0 0 0  0 1.12 0 0 0  0 0 1.16 0 0  0 0 0 0.95 0"
          result="boostA"
        />
        <feGaussianBlur in="SourceGraphic" stdDeviation="4.8" result="blurCore" />
        <feGaussianBlur in="boostA" stdDeviation="${preset.neonMode === "dual" ? preset.neonStdB : preset.neonStdA}" result="blurB" />
        <feMerge>
          <feMergeNode in="blurB" />
          <feMergeNode in="blurCore" />
          <feMergeNode in="boostA" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <filter id="exclusion-filter" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="${hexWithAlpha(mixHex(teamColors.primary, "#12060C", 0.86), "FF")}" flood-opacity="${WATERMARK_LAYER_ALPHA}" result="BackgroundImage" />
        <feBlend in="SourceGraphic" in2="BackgroundImage" mode="exclusion" />
      </filter>

      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.78 0.02" numOctaves="4" seed="7" />
      </filter>

      <clipPath id="avatar-clip">
        <circle cx="100" cy="${idY + 52}" r="36" />
      </clipPath>
    </defs>

    <g style="filter:saturate(${preset.globalSaturate}) contrast(${preset.globalContrast});">
    <rect width="1080" height="1080" fill="url(#bg-grad)" />
    <rect width="1080" height="1080" fill="url(#center-glow)" />
    <rect width="1080" height="1080" fill="${mixHex(teamColors.primary, "#000000", 0.45)}" fill-opacity="0.14" />
    <rect width="1080" height="1080" filter="url(#noise)" opacity="0.1" />
    ${Array.from({ length: 270 })
      .map((_, i) => `<line x1="0" y1="${i * 4}" x2="1080" y2="${i * 4}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`)
      .join("")}
    <g transform="rotate(-14 540 540)" filter="url(#exclusion-filter)" opacity="${WATERMARK_LAYER_ALPHA}">
      ${wallMarkup}
    </g>
    <rect width="1080" height="1080" fill="url(#laser-core)" opacity="0.74" />
    <line x1="${LASER_MAIN_LINE.x1}" y1="${LASER_MAIN_LINE.y1}" x2="${LASER_MAIN_LINE.x2}" y2="${LASER_MAIN_LINE.y2}" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="2.6" />
    <line x1="${LASER_MAIN_LINE.x1 + 20}" y1="${LASER_MAIN_LINE.y1 + LASER_SECONDARY_OFFSET_Y}" x2="${LASER_MAIN_LINE.x2 + 20}" y2="${LASER_MAIN_LINE.y2 + LASER_SECONDARY_OFFSET_Y}" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="12" />

    <text x="540" y="28" text-anchor="middle" fill="${hexWithAlpha(stanceColor, "D9")}" font-size="24" font-weight="700" text-rendering="geometricPrecision">${escapeXml(input.battleSubtitle)}</text>
    ${titleMarkup}

    <rect x="36" y="${idY}" width="1008" height="112" rx="18" fill="rgba(0,0,0,0.58)" />
    <image href="${assets.avatarDataUri}" x="64" y="${idY + 16}" width="72" height="72" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice" />
    <circle cx="100" cy="${idY + 52}" r="36" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" />
    <text x="${idTextX}" y="${idY + 30}" fill="#FFFFFF" font-size="26" font-weight="700">${escapeXml(input.displayName)}</text>
    <text x="${idTextX}" y="${idY + 66}" fill="${teamColors.primary}" font-size="24" font-weight="700">${escapeXml(input.teamLineText)}</text>

    <rect x="36" y="${goatBarY}" width="1008" height="${goatBarH}" rx="24" fill="rgba(8,8,10,0.72)" />
    <rect x="36" y="${goatBarY}" width="1008" height="${goatBarH}" rx="24" fill="url(#center-glow)" opacity="0.32" />
    <text x="540" y="${powerY}" text-anchor="middle" fill="${stanceColor}" font-size="154" font-weight="900" font-style="italic" filter="url(#fx-neon)" text-rendering="geometricPrecision">${stanceLine}</text>

    <rect x="36" y="${evidenceBarY}" width="1008" height="${evidenceBarH}" rx="12" fill="rgba(10,10,12,0.88)" />
    <rect x="36" y="${evidenceBarY}" width="1008" height="${evidenceBarH}" rx="12" fill="rgba(255,255,255,0.06)" />
    <text x="56" y="${evidenceBarY + 24}" fill="rgba(255,255,255,0.62)" font-size="18" font-weight="600">${escapeXml(input.evidenceLabel || "裁決證明：")}</text>
    <text x="56" y="${evidenceStartY}" fill="${hexWithAlpha(stanceColor, "E8")}" font-size="24" font-weight="600" text-rendering="geometricPrecision">${evidenceInlineTextPrimary}</text>
    ${evidenceInlineTextSecondary ? `<text x="56" y="${evidenceStartY + 28}" fill="${hexWithAlpha(stanceColor, "D4")}" font-size="22" font-weight="600" text-rendering="geometricPrecision">${evidenceInlineTextSecondary}</text>` : ""}

    <text x="42" y="${footerTopY + 40}" fill="${teamColors.primary}" font-size="24" font-weight="700">${escapeXml(input.regionText)}</text>
    <text x="42" y="${footerTopY + 74}" fill="rgba(255,255,255,0.86)" font-size="24" font-weight="500">${escapeXml(input.rankLineText)}</text>

    <image href="${assets.crownDataUri}" x="${crownX}" y="${crownY}" width="${crownSize}" height="${crownSize}" preserveAspectRatio="xMidYMid meet" />
    <text x="1038" y="${crownCenterY}" dominant-baseline="middle" text-anchor="end" fill="#D4AF37" font-size="30" font-weight="700">${brandLine}</text>

    <text x="436" y="${metaBaseY}" text-anchor="middle" fill="rgba(255,255,255,0.58)" font-size="12">${escapeXml(input.metaFooterLine)}</text>
    <text x="436" y="${metaBaseY + FOOTER_DISCLAIMER_OFFSET_Y}" text-anchor="middle" fill="rgba(255,255,255,0.64)" font-size="12">${escapeXml(input.disclaimerLine)}</text>
    </g>
  </svg>`;
}
