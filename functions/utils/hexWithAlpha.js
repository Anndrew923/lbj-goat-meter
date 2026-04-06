/** 與 src/utils/colorUtils.hexWithAlpha 對齊。 */

export function hexWithAlpha(hex, alphaHex) {
  if (!hex || typeof hex !== "string") return hex;
  const clean = hex.replace(/^#/, "").slice(0, 6);
  if (clean.length < 6) return hex;
  const alpha = alphaHex.length === 1 ? alphaHex + alphaHex : alphaHex;
  return `#${clean}${alpha}`;
}
