import { hashStringToSeed, mulberry32 } from "./battleCardVisualMath.js";

export const BATTLE_CARD_BASE_SIZE = 640;
export const BATTLE_CARD_EXPORT_SIZE = 1080;
export const BATTLE_CARD_EXPORT_SCALE = BATTLE_CARD_EXPORT_SIZE / BATTLE_CARD_BASE_SIZE;

const WALL_SIZE_CLASSES = ["text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
const WALL_SIZE_PX = [36, 48, 60, 72, 96, 128];

export function getPowerStanceModel(stanceDisplayName) {
  const normalized = String(stanceDisplayName || "GOAT").toUpperCase().trim() || "GOAT";
  const len = normalized.length;
  const isLong = len >= 11;
  const isMedium = len >= 8 && len <= 10;
  if (isLong) {
    const idx = normalized.indexOf(" ");
    const line1 = idx > 0 ? normalized.slice(0, idx) : normalized;
    const line2 = idx > 0 ? normalized.slice(idx + 1) : "";
    return {
      line1,
      line2,
      isMultiLine: true,
      domClassName: "text-[90px] leading-[0.85]",
      svgFontPx: 90,
      svgLineHeightPx: 76,
    };
  }
  return {
    line1: normalized,
    line2: "",
    isMultiLine: false,
    domClassName: isMedium ? "text-[95px] leading-none" : "text-[120px] leading-none",
    svgFontPx: isMedium ? 95 : 120,
    svgLineHeightPx: isMedium ? 95 : 120,
  };
}

/**
 * 文字牆模型：與 BattleCard 的 seed 規則對齊，供 DOM/SVG 同源渲染。
 */
export function buildWallWordSpecs({ wallText, battleTitle, teamColors }) {
  const normalized = String(wallText || "LAL").toUpperCase().trim() || "LAL";
  const seed = hashStringToSeed(`${normalized}|${battleTitle || ""}|${teamColors?.primary || ""}|${teamColors?.secondary || ""}`);
  const rand = mulberry32(seed);
  const specs = [];
  const wallCount = 150;
  for (let idx = 0; idx < wallCount; idx += 1) {
    const sizeIdx = Math.floor(rand() * WALL_SIZE_CLASSES.length);
    specs.push({
      id: idx,
      text: normalized,
      sizeClass: WALL_SIZE_CLASSES[sizeIdx],
      sizePx: WALL_SIZE_PX[sizeIdx],
      isBlackWeight: rand() > 0.5,
      glowAlpha: 0.75 + rand() * 0.35,
      glitchHollow: rand() < 0.28,
      glitchBold: rand() < 0.22,
    });
  }
  return specs;
}
