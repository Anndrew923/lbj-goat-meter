export const BATTLE_CARD_CANVAS = Object.freeze({
  width: 1920,
  height: 1920,
  backgroundColor: "#000000",
});

export const BATTLE_CARD_ASSETS = Object.freeze({
  backgroundImagePath: "assets/backgrounds/battlecard-base.png",
  fonts: Object.freeze({
    display: Object.freeze({
      path: "assets/fonts/GOAT-Display.ttf",
      family: "GOAT Display",
    }),
    sans: Object.freeze({
      path: "assets/fonts/GOAT-Sans.ttf",
      family: "GOAT Sans",
    }),
  }),
});

export const BATTLE_CARD_PALETTE = Object.freeze({
  textPrimary: "#F5F7FA",
  textSecondary: "#B8C0CC",
  valueText: "#FFFFFF",
  trackBase: "#1A1D24",
  avatarRing: "#D4AF37",
});

export const BATTLE_CARD_AVATAR_LAYOUT = Object.freeze({
  centerX: 960,
  centerY: 620,
  radius: 220,
  ringWidth: 8,
});

export const BATTLE_CARD_NAME_LAYOUT = Object.freeze({
  x: 960,
  y: 980,
  maxWidth: 1240,
  fontSize: 82,
  color: BATTLE_CARD_PALETTE.textPrimary,
  align: "center",
  baseline: "middle",
});

export const BATTLE_CARD_BAR_COMMON = Object.freeze({
  startX: 520,
  maxWidth: 880,
  height: 34,
  rowGap: 94,
  topY: 1150,
  labelX: 340,
  valueX: 1440,
  labelFontSize: 34,
  valueFontSize: 30,
  labelAlign: "left",
  valueAlign: "right",
  textBaseline: "middle",
  trackColor: BATTLE_CARD_PALETTE.trackBase,
});

export const BATTLE_CARD_DIMENSIONS = Object.freeze([
  Object.freeze({ key: "GOAT", order: 0, color: "#FFD700" }),
  Object.freeze({ key: "FRAUD", order: 1, color: "#FF2D55" }),
  Object.freeze({ key: "KING", order: 2, color: "#00E5FF" }),
  Object.freeze({ key: "MERCENARY", order: 3, color: "#B388FF" }),
  Object.freeze({ key: "MACHINE", order: 4, color: "#00E676" }),
  Object.freeze({ key: "STAT_PADDER", order: 5, color: "#FF9100" }),
]);
