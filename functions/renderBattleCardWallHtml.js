/**
 * 與 BattleCard.jsx mixedWallWords 同源：buildWallWordSpecs + 單一 mulberry32 字串流決定空心字。
 */

import { hashStringToSeed, mulberry32, mixHex } from "./utils/battleCardVisualMath.js";
import { hexWithAlpha } from "./utils/hexWithAlpha.js";
import { buildWallWordSpecs } from "./utils/wallWallSpecs.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBattleCardWallHtml({ wallText, battleTitle, teamColors }) {
  const primary = teamColors?.primary || "#C8102E";
  const secondary = teamColors?.secondary || "#2E003E";
  const wordSpecs = buildWallWordSpecs({ wallText, battleTitle, teamColors });
  const rand = mulberry32(
    hashStringToSeed(`${wallText}|${battleTitle}|${primary}|${secondary}`)
  );
  const smartSilver = mixHex(mixHex(primary, secondary, 0.5), "#e6e6e6", 0.55);
  const hollowStrokeColor = hexWithAlpha(smartSilver, "FF");
  const glitchRed = "rgba(255,0,80,0.35)";
  const glitchCyan = "rgba(0,220,255,0.30)";

  const parts = [];
  for (let s = 0; s < wordSpecs.length; s += 1) {
    const spec = wordSpecs[s];
    const weightClass = spec.isBlackWeight ? "900" : "100";
    const glowAlpha = spec.glowAlpha;
    const glitchHollow = spec.glitchHollow;
    const glitchBold = spec.isBlackWeight && spec.glitchBold;
    const textLen = spec.text.length;
    const hollowIdxByBlock = new Set();
    for (let start = 0; start < textLen; start += 5) {
      const end = Math.min(start + 5, textLen);
      const pick = start + Math.floor(rand() * (end - start));
      hollowIdxByBlock.add(pick);
    }

    const charSpans = [];
    const chars = spec.text.split("");
    for (let charIdx = 0; charIdx < chars.length; charIdx += 1) {
      const ch = chars[charIdx];
      const isHollow = hollowIdxByBlock.has(charIdx);
      if (isHollow) {
        const glitchShadow = glitchHollow ? `, -1px 0 0 ${glitchRed}, 1px 0 0 ${glitchCyan}` : "";
        const ts = `0 0 ${Math.round(18 * glowAlpha)}px ${hexWithAlpha(smartSilver, "33")}${glitchShadow}`;
        charSpans.push(
          `<span style="display:inline-block;line-height:1;color:transparent;-webkit-text-stroke:1px ${hollowStrokeColor};opacity:1;text-shadow:${ts}">${escapeHtml(ch)}</span>`
        );
      } else {
        const glitchShadow = glitchBold ? `, -1px 0 0 ${glitchRed}, 1px 0 0 ${glitchCyan}` : "";
        const ts = `0 0 ${Math.round(14 * glowAlpha)}px ${hexWithAlpha(smartSilver, "44")}, 0 0 ${Math.round(
          34 * glowAlpha
        )}px ${hexWithAlpha(smartSilver, "18")}${glitchShadow}`;
        charSpans.push(
          `<span style="display:inline-block;line-height:1;color:${smartSilver};opacity:1;text-shadow:${ts}">${escapeHtml(
            ch
          )}</span>`
        );
      }
    }

    parts.push(
      `<span class="wall-word" style="font-size:${spec.sizePx}px;font-weight:${weightClass};font-style:italic;text-transform:uppercase;white-space:nowrap;mix-blend-mode:exclusion;filter:brightness(1.25) saturate(0.9) contrast(1.1);font-family:'GOAT-Display',ui-sans-serif,system-ui,sans-serif">${charSpans.join("")}</span> `
    );
  }

  return parts.join("");
}
