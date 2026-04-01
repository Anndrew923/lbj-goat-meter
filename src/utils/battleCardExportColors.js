/**
 * 戰報卡隊色／點綴色 Overdrive：預覽 DOM 與（腳本用）SVG 套版共用，避免兩套色票。
 */

const BATTLE_CARD_EXPORT_OVERDRIVE_MAP = Object.freeze({
  "#8B0000": "#FF0505",
  "#552583": "#BF57FF",
  "#D4AF37": "#FFD700",
  "#008348": "#00FF41",
  "#006BB6": "#0099FF",
  "#7A0026": "#FF0505",
  "#3A0CA3": "#BF57FF",
});

function normalizeHex6(hex) {
  const s = String(hex ?? "").trim();
  if (/^#[0-9A-Fa-f]{8}$/i.test(s)) return `#${s.slice(1, 7).toUpperCase()}`;
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toUpperCase();
  return "#000000";
}

/** @param {{ primary: string, secondary: string }} teamColors */
export function applySvgExportTeamColors(teamColors) {
  const p = normalizeHex6(teamColors?.primary);
  const s = normalizeHex6(teamColors?.secondary);
  return {
    primary: BATTLE_CARD_EXPORT_OVERDRIVE_MAP[p] ?? teamColors?.primary ?? "#FF0505",
    secondary: BATTLE_CARD_EXPORT_OVERDRIVE_MAP[s] ?? teamColors?.secondary ?? "#BF57FF",
  };
}

export function applySvgExportAccentHex(hex) {
  const n = normalizeHex6(hex);
  return BATTLE_CARD_EXPORT_OVERDRIVE_MAP[n] ?? hex;
}
