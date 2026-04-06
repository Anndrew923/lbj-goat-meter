/**
 * 與 src/utils/battleCardMirrorShared.js 對齊：字牆 seed、字級、Power Stance 折行。
 */

import { hashStringToSeed, mulberry32 } from "./battleCardVisualMath.js";

const WALL_SIZE_CLASSES = ["text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
const WALL_SIZE_PX = [36, 48, 60, 72, 96, 128];

/** 與 src/utils/battleCardMirrorShared.js 同源（毛玻璃寬固定、依字數縮字級） */
const POWER_STANCE_INNER_WIDTH_PX = 520;
const POWER_STANCE_GLOW_RESERVE_PX = 16;
const POWER_STANCE_CHAR_WIDTH_RATIO = 0.66;
const POWER_STANCE_FONT_MIN_PX = 48;
const POWER_STANCE_FONT_MAX_PX = 120;

function computePowerStanceFontPx(charCount) {
  const n = Math.max(1, charCount);
  const usable = POWER_STANCE_INNER_WIDTH_PX - POWER_STANCE_GLOW_RESERVE_PX;
  const raw = Math.floor(usable / (n * POWER_STANCE_CHAR_WIDTH_RATIO));
  return Math.min(POWER_STANCE_FONT_MAX_PX, Math.max(POWER_STANCE_FONT_MIN_PX, raw));
}

export function getPowerStanceModel(stanceDisplayName) {
  const normalized = String(stanceDisplayName || "GOAT").toUpperCase().trim() || "GOAT";
  const len = normalized.length;
  const isLong = len >= 11;
  if (isLong) {
    const idx = normalized.indexOf(" ");
    const line1 = idx > 0 ? normalized.slice(0, idx) : normalized;
    const line2 = idx > 0 ? normalized.slice(idx + 1).trim() : "";
    const maxLineChars = line2 ? Math.max(line1.length, line2.length) : line1.length;
    const fontSizePx = computePowerStanceFontPx(maxLineChars);
    return {
      line1,
      line2,
      isMultiLine: true,
      fontSize: fontSizePx,
      lineHeight: 0.85,
    };
  }
  const fontSizePx = computePowerStanceFontPx(len);
  return {
    line1: normalized,
    line2: "",
    isMultiLine: false,
    fontSize: fontSizePx,
    lineHeight: 1,
  };
}

export function buildWallWordSpecs({ wallText, battleTitle, teamColors }) {
  const normalized = String(wallText || "LAL").toUpperCase().trim() || "LAL";
  const seed = hashStringToSeed(
    `${normalized}|${battleTitle || ""}|${teamColors?.primary || ""}|${teamColors?.secondary || ""}`
  );
  const rand = mulberry32(seed);
  const specs = [];
  const wallCount = 150;
  for (let idx = 0; idx < wallCount; idx += 1) {
    const sizeIdx = Math.floor(rand() * WALL_SIZE_CLASSES.length);
    specs.push({
      id: idx,
      text: normalized,
      sizePx: WALL_SIZE_PX[sizeIdx],
      isBlackWeight: rand() > 0.5,
      glowAlpha: 0.75 + rand() * 0.35,
      glitchHollow: rand() < 0.28,
      glitchBold: rand() < 0.22,
    });
  }
  return specs;
}
