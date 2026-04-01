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
  textSecondary: "#D7C8C8",
  valueText: "#FFFFFF",
  trackBase: "#151217",
  avatarRing: "#D4AF37",
  stanceGlow: "#FF4D00",
  panelBg: "rgba(0,0,0,0.68)",
  panelStroke: "rgba(255,255,255,0.14)",
});

export const BATTLE_CARD_AVATAR_LAYOUT = Object.freeze({
  centerX: 168,
  centerY: 345,
  radius: 56,
  ringWidth: 8,
});

export const BATTLE_CARD_NAME_LAYOUT = Object.freeze({
  x: 260,
  y: 332,
  maxWidth: 540,
  fontSize: 48,
  color: BATTLE_CARD_PALETTE.textPrimary,
  align: "left",
  baseline: "middle",
});

export const BATTLE_CARD_BAR_COMMON = Object.freeze({
  startX: 520,
  maxWidth: 880,
  height: 30,
  rowGap: 96,
  topY: 1180,
  labelX: 330,
  valueX: 1450,
  labelFontSize: 46,
  valueFontSize: 42,
  labelAlign: "left",
  valueAlign: "right",
  textBaseline: "middle",
  trackColor: BATTLE_CARD_PALETTE.trackBase,
});

export const BATTLE_CARD_HUD_LAYOUT = Object.freeze({
  subtitleY: 88,
  titleY: 158,
  identityPanel: Object.freeze({
    x: 64,
    y: 254,
    width: 1792,
    height: 180,
    radius: 28,
  }),
  stancePanel: Object.freeze({
    x: 52,
    y: 650,
    width: 1816,
    height: 300,
    radius: 34,
  }),
  evidencePanel: Object.freeze({
    x: 52,
    y: 1016,
    width: 1816,
    height: 180,
    radius: 20,
  }),
  footerY: 1710,
});

/**
 * BattleCard.jsx -> SSR 365 基準座標映射表（CARD_SIZE=640）。
 * 換算規則：SSR(px) = base365 * (1920 / 365)。
 */
export const BATTLE_CARD_WORKSHEET_365 = Object.freeze({
  scaleBase: 1920 / 365,
  skewDeg: 12,
  letterSpacing: -1.5,
  identityPanel: Object.freeze({
    x: 6,
    y: 48,
    width: 353,
    height: 35,
  }),
  stancePanel: Object.freeze({
    x: 4,
    y: 114,
    width: 357,
    height: 70,
  }),
  evidencePanel: Object.freeze({
    x: 4,
    y: 188,
    width: 357,
    height: 30,
  }),
  avatar: Object.freeze({
    cx: 15,
    cy: 66,
    r: 10.6,
  }),
  displayName: Object.freeze({
    x: 26,
    y: 66,
    maxWidth: 120,
  }),
  title: Object.freeze({
    subtitleX: 182,
    subtitleY: 28,
    headingX: 182,
    headingY: 40,
    stanceX: 182,
    stanceY: 149,
  }),
  crown: Object.freeze({
    x: 258,
    y: 148,
    size: 24,
  }),
  bars: Object.freeze({
    startX: 105,
    startY: 300,
    width: 150,
    height: 4.2,
    rowGap: 14.2,
    labelX: 82,
    valueX: 264,
  }),
  footer: Object.freeze({
    regionX: 10,
    regionY: 339,
    leftMetaX: 10,
    leftMetaY: 331,
    brandX: 350,
    brandY: 337,
    buildX: 8,
    buildY: 357,
  }),
});

export const BATTLE_CARD_DIMENSIONS = Object.freeze([
  Object.freeze({ key: "GOAT", order: 0, color: "#FFD700" }),
  Object.freeze({ key: "FRAUD", order: 1, color: "#FF2D55" }),
  Object.freeze({ key: "KING", order: 2, color: "#00E5FF" }),
  Object.freeze({ key: "MERCENARY", order: 3, color: "#B388FF" }),
  Object.freeze({ key: "MACHINE", order: 4, color: "#00E676" }),
  Object.freeze({ key: "STAT_PADDER", order: 5, color: "#FF9100" }),
]);
