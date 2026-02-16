/**
 * 顏色工具：hex 加 alpha，供 BattleCard 邊框光暈、陰影等使用。
 * 僅取前 6 字元作為 RGB，避免 8 字元 hex 重複疊加。
 */

/**
 * @param {string} hex - 如 #D4AF37 或 D4AF37
 * @param {string} alphaHex - 如 '80' 或 'A0'（1～2 字元）
 * @returns {string} 8 字元 hex 或原值（無效時）
 */
export function hexWithAlpha(hex, alphaHex) {
  if (!hex || typeof hex !== 'string') return hex
  const clean = hex.replace(/^#/, '').slice(0, 6)
  if (clean.length < 6) return hex
  const alpha = alphaHex.length === 1 ? alphaHex + alphaHex : alphaHex
  return `#${clean}${alpha}`
}
