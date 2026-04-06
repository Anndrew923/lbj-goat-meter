/** 與 src/utils/battleCardVisualMath.js 對齊，供 SSR 字牆／色運算。 */

export function hashStringToSeed(str) {
  const s = String(str ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const clean = String(hex || "").replace(/^#/, "");
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const to = (v) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function mixHex(a, b, mix) {
  const ma = hexToRgb(a);
  const mb = hexToRgb(b);
  const t = Math.max(0, Math.min(1, mix));
  return rgbToHex(ma.r + (mb.r - ma.r) * t, ma.g + (mb.g - ma.g) * t, ma.b + (mb.b - ma.b) * t);
}
