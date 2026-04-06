/**
 * 與前端 src/lib/constants STANCE_COLORS、arena.json stances.primary 對齊。
 * 後端無法直接 import Vite 前端模組，故在此維持單一後端來源，變更立場色／標籤時請同步兩處。
 */
export const SSR_BATTLE_CARD_STANCE_COLORS = Object.freeze({
  goat: "#D4AF37",
  fraud: "#4B0082",
  king: "#B42832",
  mercenary: "#00E676",
  machine: "#E0E0E0",
  stat_padder: "#B87333",
});

export const SSR_BATTLE_CARD_STANCE_PRIMARY = Object.freeze({
  goat: "GOAT",
  fraud: "FRAUD",
  king: "KING",
  mercenary: "MERCENARY",
  machine: "MACHINE",
  stat_padder: "STAT PADDER",
});
