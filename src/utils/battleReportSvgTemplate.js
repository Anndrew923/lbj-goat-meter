import { hexWithAlpha } from "./colorUtils.js";
import { mixHex } from "./battleCardVisualMath.js";

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
const DESIGN_CARD_SIZE = 640;
const SCALE = CANVAS_SIZE / DESIGN_CARD_SIZE;
const P6 = Math.round(24 * SCALE);
const GAP_1 = Math.round(4 * SCALE);
const H_16 = Math.round(64 * SCALE);
const H_20 = Math.round(80 * SCALE);

const TOP_SUBTITLE_FONT_SIZE = Math.round(14 * SCALE);
const TOP_TITLE_FONT_SIZE = Math.round(56 * SCALE);
const CONTENT_GAP = Math.round(12 * SCALE);

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

function brightenHex(hex, amount) {
  const value = String(hex || "#000000").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((ch) => `${ch}${ch}`).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const next = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * amount)));
  return `#${[next(r), next(g), next(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
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

function buildWatermarkTextWall(stanceDisplayName) {
  const wallWord = escapeXml(String(stanceDisplayName || "GOAT").toUpperCase().trim() || "GOAT");
  const rows = [];
  const rowGap = Math.round(48 * SCALE);
  const rowCount = 18;
  for (let idx = 0; idx < rowCount; idx += 1) {
    rows.push({
      x: idx % 2 === 0 ? -Math.round(70 * SCALE) : Math.round(50 * SCALE),
      y: Math.round(170 * SCALE) + idx * rowGap,
      size: idx % 3 === 0 ? Math.round(58 * SCALE) : Math.round(44 * SCALE),
      letters: `${wallWord} ${wallWord} ${wallWord}`,
    });
  }
  return rows
    .map(
      (row) =>
        `<text x="${row.x}" y="${row.y}" font-size="${row.size}" font-style="italic" font-weight="900" letter-spacing="2">${row.letters}</text>`,
    )
    .join("");
}

/**
 * SVG 戰報模板：以宣告式圖層描述取代指令式 Canvas，確保可維護與可測試。
 */
export function buildBattleReportSvg(input, assets) {
  const teamColors = input.teamColors ?? { primary: "#7A0026", secondary: "#3A0CA3" };
  const stanceColor = input.stanceColor ?? "#D4AF37";
  const titleLines = breakLineByChars(input.battleTitle, TITLE_MAX_CHARS_PER_LINE, TITLE_MAX_LINES);
  const evidenceLines = buildEvidenceLines(input.reasonLabels);
  const stanceLine = escapeXml(String(input.stanceDisplayName || "GOAT").toUpperCase());
  const wallMarkup = buildWatermarkTextWall(input.stanceDisplayName);
  const wallColorBright20 = brightenHex(teamColors.primary, 0.2);
  const subtitleY = P6 + TOP_SUBTITLE_FONT_SIZE;
  const titleStep = Math.round(40 * SCALE);
  const titleY = subtitleY + TOP_SUBTITLE_FONT_SIZE + GAP_1;
  const titleBottomY = titleY + Math.max(0, titleLines.length - 1) * titleStep + TOP_TITLE_FONT_SIZE;

  const idY = titleBottomY + CONTENT_GAP;
  const idTextX = P6 + Math.round(76 * SCALE);
  const idAvatarSize = Math.round(48 * SCALE);
  const idAvatarX = P6 + Math.round(8 * SCALE);
  const idAvatarY = idY + Math.round((H_16 - idAvatarSize) / 2);

  const powerY = idY + H_16 + CONTENT_GAP;
  const powerH = Math.round(120 * SCALE);
  const powerTextY = powerY + Math.round(92 * SCALE);

  const evidenceY = powerY + powerH + CONTENT_GAP;
  const evidenceLine1Y = evidenceY + Math.round(22 * SCALE);
  const evidenceLine2Y = evidenceLine1Y + Math.round(24 * SCALE);

  const footerY = CANVAS_SIZE - P6 - H_20;
  const footerBaselineY = footerY + Math.round(30 * SCALE);
  const crownSize = Math.round(40 * SCALE);
  const crownX = CANVAS_SIZE - P6 - crownSize - Math.round(150 * SCALE);
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
  const locationLine = escapeXml(input.locationLine || input.rankLineText || input.regionText || "");
  const evidenceInlineTextPrimary = escapeXml(evidenceLines[0] || "-");
  const evidenceInlineTextSecondary = escapeXml(evidenceLines[1] || "");

  const titleMarkup = titleLines
    .map(
      (line, idx) =>
        `<text x="${CANVAS_SIZE / 2}" y="${titleY + idx * titleStep}" text-anchor="middle" fill="${stanceColor}" font-size="${TOP_TITLE_FONT_SIZE}" font-style="${input.isTitleUppercase ? "italic" : "normal"}" font-weight="900" filter="url(#fx-neon-overdrive)">${escapeXml(line)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" text-rendering="geometricPrecision">
    <defs>
      <style>
        text { text-rendering: geometricPrecision; }
      </style>
      <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${hexWithAlpha(teamColors.primary, "FF")}" />
        <stop offset="45%" stop-color="${hexWithAlpha(teamColors.primary, "E6")}" />
        <stop offset="50%" stop-color="rgba(0,0,0,0.8)" />
        <stop offset="55%" stop-color="${hexWithAlpha(teamColors.secondary, "E6")}" />
        <stop offset="100%" stop-color="${hexWithAlpha(teamColors.secondary, "FF")}" />
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

      <filter id="wall-exclusion-filter" x="-20%" y="-20%" width="160%" height="160%">
        <feFlood flood-color="${wallColorBright20}" flood-opacity="1" result="wallTint" />
        <feBlend in="SourceGraphic" in2="wallTint" mode="exclusion" result="wallBlend" />
        <feComposite in="wallBlend" in2="SourceAlpha" operator="in" />
      </filter>
      <pattern id="noise-pattern" patternUnits="userSpaceOnUse" width="180" height="180">
        <image href="${NOISE_DATA_URL}" x="0" y="0" width="180" height="180" />
      </pattern>

      <clipPath id="avatar-clip">
        <circle cx="${idAvatarX + idAvatarSize / 2}" cy="${idAvatarY + idAvatarSize / 2}" r="${idAvatarSize / 2}" />
      </clipPath>
    </defs>

    <g style="filter:saturate(1.5) contrast(1.18) brightness(1.06);">
    <rect width="1080" height="1080" fill="url(#bg-grad)" />
    <rect width="1080" height="1080" fill="url(#center-glow)" />
    <rect width="1080" height="1080" fill="${mixHex(teamColors.primary, teamColors.secondary, 0.5)}" fill-opacity="0.2" />
    <rect width="1080" height="1080" fill="url(#noise-pattern)" opacity="0.2" />
    ${Array.from({ length: 270 })
      .map((_, i) => `<line x1="0" y1="${i * 4}" x2="1080" y2="${i * 4}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`)
      .join("")}
    <g transform="rotate(-15 ${CANVAS_SIZE / 2} ${CANVAS_SIZE / 2})" filter="url(#wall-exclusion-filter)" opacity="0.92">
      ${wallMarkup}
    </g>
    <rect width="1080" height="1080" fill="url(#laser-core)" opacity="0.82" />
    <line x1="${laserMain.x1}" y1="${laserMain.y1}" x2="${laserMain.x2}" y2="${laserMain.y2}" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="3" />
    <line x1="${laserSecondary.x1}" y1="${laserSecondary.y1}" x2="${laserSecondary.x2}" y2="${laserSecondary.y2}" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="12" />

    <text x="${CANVAS_SIZE / 2}" y="${subtitleY}" text-anchor="middle" fill="${hexWithAlpha(stanceColor, "CC")}" font-size="${TOP_SUBTITLE_FONT_SIZE}" font-weight="700" letter-spacing="6">${escapeXml(input.battleSubtitle)}</text>
    ${titleMarkup}

    <rect x="${P6}" y="${idY}" width="${CANVAS_SIZE - P6 * 2}" height="${H_16}" rx="18" fill="rgba(0,0,0,0.45)" />
    <image href="${assets.avatarDataUri}" x="${idAvatarX}" y="${idAvatarY}" width="${idAvatarSize}" height="${idAvatarSize}" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice" />
    <circle cx="${idAvatarX + idAvatarSize / 2}" cy="${idAvatarY + idAvatarSize / 2}" r="${idAvatarSize / 2}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" />
    <text x="${idTextX}" y="${idY + Math.round(28 * SCALE)}" fill="#FFFFFF" font-size="${Math.round(14 * SCALE)}" font-weight="700">${escapeXml(input.displayName)}</text>
    <text x="${idTextX}" y="${idY + Math.round(47 * SCALE)}" fill="${teamColors.primary}" font-size="${Math.round(14 * SCALE)}" font-weight="700">${escapeXml(input.teamLineText)}</text>

    <rect x="${P6}" y="${powerY}" width="${CANVAS_SIZE - P6 * 2}" height="${powerH}" rx="32" fill="rgba(0,0,0,0.75)" />
    <text x="${CANVAS_SIZE / 2}" y="${powerTextY}" text-anchor="middle" fill="${stanceColor}" font-size="${Math.round(90 * SCALE)}" font-weight="900" font-style="italic" filter="url(#fx-neon-overdrive)">${stanceLine}</text>

    <rect x="${P6}" y="${evidenceY}" width="${CANVAS_SIZE - P6 * 2}" height="${H_20}" rx="12" fill="rgba(10,10,12,0.88)" />
    <text x="${P6 + Math.round(12 * SCALE)}" y="${evidenceY + Math.round(16 * SCALE)}" fill="rgba(255,255,255,0.62)" font-size="${Math.round(10 * SCALE)}" font-weight="600">${escapeXml(input.evidenceLabel || "裁決證明：")}</text>
    <text x="${P6 + Math.round(12 * SCALE)}" y="${evidenceLine1Y}" fill="${hexWithAlpha(stanceColor, "E8")}" font-size="${Math.round(13 * SCALE)}" font-weight="600">${evidenceInlineTextPrimary}</text>
    ${evidenceInlineTextSecondary ? `<text x="${P6 + Math.round(12 * SCALE)}" y="${evidenceLine2Y}" fill="${hexWithAlpha(stanceColor, "D4")}" font-size="${Math.round(12 * SCALE)}" font-weight="600">${evidenceInlineTextSecondary}</text>` : ""}

    <line x1="${P6}" y1="${footerY - Math.round(8 * SCALE)}" x2="${CANVAS_SIZE - P6}" y2="${footerY - Math.round(8 * SCALE)}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
    <text x="${P6}" y="${footerBaselineY}" fill="${teamColors.primary}" font-size="${Math.round(12 * SCALE)}" font-weight="700">${locationLine}</text>

    <image href="${assets.crownDataUri}" x="${crownX}" y="${crownY}" width="${crownSize}" height="${crownSize}" preserveAspectRatio="xMidYMid meet" />
    <text x="${brandTextX}" y="${crownCenterY}" dominant-baseline="middle" text-anchor="end" fill="#D4AF37" font-size="${Math.round(12 * SCALE)}" font-weight="700">${brandLine || "The GOAT Meter"}</text>

    <text x="${CANVAS_SIZE / 2}" y="${metaBaseY}" text-anchor="middle" fill="rgba(255,255,255,0.58)" font-size="${FOOTER_META_FONT_SIZE}">${escapeXml(input.metaFooterLine)}</text>
    <text x="${CANVAS_SIZE / 2}" y="${metaBaseY + Math.round(12 * SCALE)}" text-anchor="middle" fill="rgba(255,255,255,0.64)" font-size="${FOOTER_DISCLAIMER_FONT_SIZE}">${escapeXml(input.disclaimerLine)}</text>
    </g>
  </svg>`;
}
