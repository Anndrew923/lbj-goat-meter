/**
 * 全量視覺 SSR：與 BattleCard.jsx 匯出場景對齊（640 邏輯座標 × scale 1.6875 → 1080）。
 * 含：115° 斜向能量縫合（card-container 雙層漸層 + 縫線）、Word Wall（mulberry32／renderBattleCardWallHtml）、
 * GOAT-Display @font-face、身分列玻璃質感（backdrop-filter）。
 */

import { SSR_BATTLE_CARD_STANCE_COLORS } from "./battleCardConstants.js";
import { renderBattleCardWallHtml } from "./renderBattleCardWallHtml.js";
import { mixHex, hexToRgb, rgbToHex } from "./utils/battleCardVisualMath.js";
import { hexWithAlpha } from "./utils/hexWithAlpha.js";
import { getPowerStanceModel } from "./utils/wallWallSpecs.js";

const NOISE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8 0.02' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' fill='%23d0d0d0'/%3E%3C/svg%3E";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveHostingOrigin() {
  const raw = (process.env.BATTLE_CARD_HOSTING_ORIGIN || process.env.RENDER_STUDIO_BASE_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || "lbj-goat-meter";
  return `https://${projectId}.web.app`;
}

/**
 * 強化 head：Hosting 絕對字型 URL、抗鋸齒、.card-container 雙層漸層 + 縫線、硬體加速、斜向反射掃光、HUD 角標。
 * 字型須存在 public/fonts/GOAT-Display.ttf（部署後 /fonts/GOAT-Display.ttf 可直連）。
 */
function buildEnhancedHead({
  fontUrl,
  pFF,
  pE6,
  sE6,
  sFF,
  stitch,
  cornerTopRimAlpha,
  cornerBottomRimAlpha,
}) {
  return `<head>
<meta charset="utf-8"/>
<style>
@font-face{font-family:'GOAT-Display';src:url('${fontUrl}') format('truetype');font-display:block}
*{box-sizing:border-box;transition:none!important;animation:none!important}
html,body{margin:0;padding:0;width:1080px;height:1080px;overflow:hidden;background:#000;color:#fff;
  font-family:'GOAT-Display',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
#stage{width:1080px;height:1080px;position:relative;overflow:hidden;background:#000}
#scale{width:640px;height:640px;transform:scale(1.6875);transform-origin:top left;position:relative}
.battle-card-root.card-container{
  background:linear-gradient(115deg,${pFF} 0%,${pE6} 45%,rgba(0,0,0,0.8) 50%,${sE6} 55%,${sFF} 100%),${stitch}!important;
  background-size:100% 100%,100% 100%;
  transform:translateZ(0);
  backface-visibility:hidden;
  -webkit-backface-visibility:hidden;
}
.reflective-sweep{position:absolute;inset:0;z-index:2;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,0.4) 50%,transparent 60%);mix-blend-mode:overlay;pointer-events:none;opacity:0.88}
.bc-corner::before,.bc-corner::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:16px;opacity:0.88;z-index:11;background-repeat:no-repeat}
.bc-corner::before{
  background-image:linear-gradient(${cornerTopRimAlpha},${cornerTopRimAlpha}),linear-gradient(${cornerTopRimAlpha},${cornerTopRimAlpha}),linear-gradient(${cornerTopRimAlpha},${cornerTopRimAlpha}),linear-gradient(${cornerTopRimAlpha},${cornerTopRimAlpha});
  background-size:20px 1px,1px 20px,20px 1px,1px 20px;
  background-position:0 0,0 0,100% 0,100% 0;
}
.bc-corner::after{
  background-image:linear-gradient(${cornerBottomRimAlpha},${cornerBottomRimAlpha}),linear-gradient(${cornerBottomRimAlpha},${cornerBottomRimAlpha}),linear-gradient(${cornerBottomRimAlpha},${cornerBottomRimAlpha}),linear-gradient(${cornerBottomRimAlpha},${cornerBottomRimAlpha});
  background-size:20px 1px,1px 20px,20px 1px,1px 20px;
  background-position:0 100%,0 100%,100% 100%,100% 100%;
}
</style>
</head>`;
}

/**
 * @param {object} data — 與 generateBattleCard validatedPayload 相同（theme、stanceDisplayPrimary、reasonLabels…）
 */
export function buildBattleCardVisualHtml(data) {
  const primary = data.theme?.primaryColor || "#C8102E";
  const secondary = data.theme?.secondaryColor || "#2E003E";
  const stanceKey = String(data.status || "goat").toLowerCase();
  const stanceC = SSR_BATTLE_CARD_STANCE_COLORS[stanceKey] || SSR_BATTLE_CARD_STANCE_COLORS.goat;
  const stanceTitle = String(data.stanceDisplayPrimary || stanceKey || "GOAT").toUpperCase();
  const pm = getPowerStanceModel(stanceTitle);
  /** 字牆：與 App 一致用戰區代碼（如 GSW）；身分列：可為在地化 teamLabel */
  const wallWord = String(data.voterTeam || data.teamLabel || "LAL").toUpperCase().trim() || "LAL";
  const identityTeamLabel =
    data.teamLabel != null && String(data.teamLabel).trim() !== ""
      ? String(data.teamLabel).toUpperCase()
      : wallWord;
  const displayName = escapeHtml(String(data.displayName || "Warrior"));
  const battleTitle = escapeHtml(String(data.battleTitle || ""));
  const battleSubtitle = escapeHtml(String(data.battleSubtitle || ""));
  const rankLabel = escapeHtml(String(data.rankLabel || ""));
  const reasons = Array.isArray(data.reasonLabels) ? data.reasonLabels.map((r) => escapeHtml(String(r))) : [];
  const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";

  const wallHtml = renderBattleCardWallHtml({
    wallText: wallWord,
    battleTitle: data.battleTitle || "",
    teamColors: { primary, secondary },
  });

  const wallPrimaryGlow = hexWithAlpha(primary, "33");
  const wallSecondaryGlow = hexWithAlpha(secondary, "26");
  const deepSecondary = mixHex(secondary, "#000000", 0.62);
  const extremeSecondary = mixHex(secondary, "#ffffff", 0.9);
  const neutralSecondary = mixHex(secondary, "#bdbdbd", 0.52);
  const brightSecondary = mixHex(secondary, "#ffffff", 0.68);
  const chromeBorderGradient = `linear-gradient(135deg, ${deepSecondary} 0%, ${extremeSecondary} 20%, ${extremeSecondary} 36%, ${neutralSecondary} 44%, ${brightSecondary} 62%, ${deepSecondary} 100%)`;

  const reflectiveTint20 = hexWithAlpha(primary, "20");
  const reflectiveTint40 = hexWithAlpha(primary, "40");
  const reflectiveTint60 = hexWithAlpha(primary, "60");
  const reflectiveSecondaryTint20 = hexWithAlpha(secondary, "20");
  const reflectiveSecondaryTint40 = hexWithAlpha(secondary, "40");
  const reflectiveSecondaryTint60 = hexWithAlpha(secondary, "60");
  const reflectiveCoreCool = hexWithAlpha(mixHex(mixHex(primary, secondary, 0.5), "#ffffff", 0.78), "D9");
  const laserCutTint = mixHex(mixHex(primary, secondary, 0.5), "#ffffff", 0.35);
  const laserCutColor = hexWithAlpha(laserCutTint, "E8");

  const { r: pR, g: pG, b: pB } = hexToRgb(primary);
  const { r: sR, g: sG, b: sB } = hexToRgb(secondary);
  const complementPrimary = rgbToHex(255 - pR, 255 - pG, 255 - pB);
  const complementSecondary = rgbToHex(255 - sR, 255 - sG, 255 - sB);
  const cornerTopRimAlpha = hexWithAlpha(mixHex(complementPrimary, primary, 0.35), "F0");
  const cornerBottomRimAlpha = hexWithAlpha(mixHex(complementSecondary, secondary, 0.35), "F0");
  const textHudEdgeShadow = `0 1px 2px ${hexWithAlpha(mixHex(secondary, "#000000", 0.6), "D0")}`;

  /**
   * Power Stance 中央字樣：與 BattleCard.jsx 對齊。
   * - 明確使用 sans 堆疊，避免繼承 html/body 的 GOAT-Display（與 App 的 font-black + 預設 sans 一致）。
   * - textShadow + 四層 filter 與前端 `textHudEdgeShadow` + LED 霓虹疊法同源。
   */
  const powerStanceSans =
    "ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const powerStanceFilter = `drop-shadow(0 0 30px ${stanceC}) drop-shadow(0 0 18px ${hexWithAlpha(primary, "70")}) drop-shadow(0 0 8px ${reflectiveTint60}) drop-shadow(0 2px 3px rgba(0,0,0,1))`;

  const pFF = hexWithAlpha(primary, "FF");
  const pE6 = hexWithAlpha(primary, "E6");
  const sE6 = hexWithAlpha(secondary, "E6");
  const sFF = hexWithAlpha(secondary, "FF");
  const stitch = `repeating-linear-gradient(115deg,${hexWithAlpha(mixHex(primary, secondary, 0.5), "12")} 0px,${hexWithAlpha(mixHex(primary, secondary, 0.5), "12")} 1px,transparent 1px,transparent 10px)`;

  const hosting = resolveHostingOrigin();
  /** 與 Hosting public/fonts/GOAT-Display.ttf 對齊（預設即 lbj-goat-meter.web.app/fonts/...） */
  const fontUrl = `${hosting}/fonts/GOAT-Display.ttf`;
  /** 與 App 相同資產：public/goat-crown-icon.png（固定路徑，避免 Vite hash） */
  const crownImgUrl = `${hosting}/goat-crown-icon.png`;

  const regionLine = escapeHtml(String(data.regionText != null && String(data.regionText).trim() !== "" ? data.regionText : "GLOBAL"));
  const verdictSectionLabel = escapeHtml(
    String(data.verdictSectionLabel != null && String(data.verdictSectionLabel).trim() !== "" ? data.verdictSectionLabel : "VERDICT / 證詞")
  );
  const metaFooterLine = escapeHtml(
    String(data.metaFooterLine != null && String(data.metaFooterLine).trim() !== "" ? data.metaFooterLine : "VERIFIED DATA · GOAT METER")
  );
  const disclaimerLine = escapeHtml(
    String(data.disclaimerLine != null && String(data.disclaimerLine).trim() !== "" ? data.disclaimerLine : "Fan sentiment stats. Not affiliated with any player or league.")
  );

  const stanceLineHtml = pm.isMultiLine
    ? `${escapeHtml(pm.line1)}<br/>${escapeHtml(pm.line2 || "")}`
    : escapeHtml(pm.line1);

  const reasonsBlock =
    reasons.length > 0
      ? `<div style="margin:10px 20px 0;padding:12px;border-radius:8px;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.1);max-height:120px;overflow-y:auto">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.5)">${verdictSectionLabel}</p>
          <p style="margin:0;line-height:1.35">${reasons.map((r) => `<span style="color:${stanceC};font-size:13px;font-weight:600;text-shadow:${textHudEdgeShadow}">${r}</span>`).join(" / ")}</p>
        </div>`
      : "";

  const avatarBlock = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" crossorigin="anonymous" referrerpolicy="no-referrer" alt="" style="width:100%;height:100%;object-fit:cover"/>`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;color:rgba(255,255,255,0.55)">?</div>`;

  const cardInnerHtml = `
<div class="battle-card-root card-container" style="position:relative;width:640px;height:640px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-height:0;
  border:2px solid transparent;border-image:${chromeBorderGradient} 1;
  filter:saturate(1.45) contrast(1.15) brightness(1.05);
  box-shadow:inset 0 0 80px rgba(0,0,0,0.88),0 0 18px ${hexWithAlpha(secondary, "44")},inset 0 0 60px ${hexWithAlpha(extremeSecondary, "20")}">
  <div class="bc-corner" style="position:absolute;inset:0;z-index:12;pointer-events:none;border-radius:16px;filter:drop-shadow(0 0 2px ${cornerTopRimAlpha}) drop-shadow(0 0 6px ${cornerBottomRimAlpha}) drop-shadow(0 0 14px ${hexWithAlpha(secondary, "55")})"></div>
  <div style="position:absolute;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(circle at center 30%,${wallPrimaryGlow} 0%,transparent 62%),radial-gradient(circle at bottom right,${wallSecondaryGlow} 0%,transparent 58%);filter:saturate(1.2) contrast(1.05);opacity:0.95"></div>
  <div style="position:absolute;inset:0;z-index:1;pointer-events:none;background-image:linear-gradient(115deg,transparent 49.6%,${hexWithAlpha(laserCutColor, "99")} 49.75%,#FFFFFF 50%,${hexWithAlpha(laserCutColor, "99")} 50.25%,transparent 50.4%);mix-blend-mode:normal;opacity:0.82;filter:drop-shadow(0 0 2px #FFFFFF) drop-shadow(0 0 10px ${laserCutColor}) drop-shadow(0 0 18px ${hexWithAlpha(laserCutColor, "99")}) contrast(1.4) brightness(1.15)"></div>
  <div class="reflective-sweep" aria-hidden="true"></div>
  <div style="position:absolute;left:0;right:0;top:-10%;height:120%;z-index:3;pointer-events:none;background-image:linear-gradient(145deg,transparent 18%,${reflectiveTint20} 22%,${reflectiveTint60} 24%,${reflectiveSecondaryTint20} 26%,${reflectiveSecondaryTint60} 28%,${reflectiveCoreCool} 29%,${reflectiveCoreCool} 31%,${reflectiveTint40} 33%,transparent 45%);mix-blend-mode:screen;opacity:0.9;filter:contrast(1.2) brightness(1.05)"></div>
  <div style="position:absolute;inset:0;z-index:4;transform:rotate(-15deg);opacity:0.92;overflow:hidden;display:flex;flex-wrap:wrap;gap:8px 16px;padding:16px;align-content:flex-start;mix-blend-mode:exclusion;filter:brightness(1.25) saturate(1.2) contrast(1.05);
    -webkit-mask-image:radial-gradient(circle at 50% 50%,rgba(0,0,0,0.10) 0%,rgba(0,0,0,0.08) 20%,rgba(0,0,0,0.06) 45%,rgba(0,0,0,0.035) 70%,rgba(0,0,0,0.012) 100%);
    mask-image:radial-gradient(circle at 50% 50%,rgba(0,0,0,0.10) 0%,rgba(0,0,0,0.08) 20%,rgba(0,0,0,0.06) 45%,rgba(0,0,0,0.035) 70%,rgba(0,0,0,0.012) 100%)">${wallHtml}</div>
  <div style="position:absolute;inset:0;z-index:5;pointer-events:none;border-radius:16px;opacity:0.06;background-image:url('${NOISE_DATA_URL}');background-repeat:repeat"></div>
  <div style="position:absolute;inset:0;z-index:6;pointer-events:none;border-radius:16px;background:${mixHex(primary, secondary, 0.5)};opacity:0.2;mix-blend-mode:normal;filter:saturate(1.25)"></div>
  <div style="position:absolute;inset:0;z-index:7;pointer-events:none;border-radius:16px;opacity:0.9;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.02) 0px 1px,transparent 1px 20px),repeating-linear-gradient(90deg,rgba(255,255,255,0.02) 0px 1px,transparent 1px 20px),repeating-linear-gradient(180deg,rgba(255,255,255,0.03) 0px 1px,transparent 1px 7px);filter:contrast(1.2) brightness(1.05)"></div>
  <div style="position:absolute;inset:0;z-index:8;pointer-events:none;border-radius:16px;border:1px solid rgba(255,255,255,0.1);box-shadow:inset 0 0 60px rgba(0,0,0,0.3),0 0 30px ${hexWithAlpha(primary, "15")}"></div>
  <div style="position:relative;z-index:20;flex:1;min-height:0;display:flex;flex-direction:column;padding:20px 20px 10px;letter-spacing:0.02em">
    <div style="position:relative;text-align:center;text-transform:uppercase;flex-shrink:0;margin-bottom:12px;padding-top:20px">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:128px;height:128px;border-radius:9999px;opacity:0.6;filter:blur(48px);background:${stanceC}"></div></div>
      <h2 style="position:relative;margin:0 0 4px;font-size:12px;letter-spacing:0.2em;font-weight:600;color:${hexWithAlpha(stanceC, "CC")};text-shadow:${textHudEdgeShadow}">${battleSubtitle}</h2>
      <h1 style="position:relative;margin:0;font-size:34px;font-weight:900;font-style:italic;letter-spacing:-0.03em;color:${stanceC};text-transform:uppercase;white-space:nowrap;text-shadow:${textHudEdgeShadow},0 0 16px ${hexWithAlpha(stanceC, "44")}">${battleTitle}</h1>
    </div>
    <div style="position:relative;display:flex;gap:12px;align-items:center;border-radius:12px;padding:8px;margin-bottom:12px;overflow:hidden">
      <div style="position:absolute;inset:0;border-radius:12px;background:rgba(0,0,0,0.38);z-index:0;backdrop-filter:blur(14px) saturate(1.25);-webkit-backdrop-filter:blur(14px) saturate(1.25);border:1px solid rgba(255,255,255,0.12);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06)"></div>
      <div style="position:relative;z-index:1;width:48px;height:48px;border-radius:50%;overflow:hidden;border:2px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);flex-shrink:0">${avatarBlock}</div>
      <div style="position:relative;z-index:1;min-width:0;flex:1">
        <p style="margin:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;text-shadow:${textHudEdgeShadow}">${displayName}</p>
        <p style="margin:4px 0 0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${primary};text-shadow:${textHudEdgeShadow}">${escapeHtml(identityTeamLabel)}</p>
      </div>
    </div>
    <div style="position:relative;margin:12px 40px;padding:20px 24px;border-radius:16px;text-align:center">
      <div style="position:absolute;inset:0;margin:0 -16px;border-radius:16px;background:rgba(0,0,0,0.75);z-index:-1;box-shadow:0 0 40px rgba(0,0,0,0.45)"></div>
      <div style="position:relative;box-sizing:border-box;max-width:100%;font-family:${powerStanceSans};font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-0.05em;color:${stanceC};font-size:${pm.fontSize}px;line-height:${pm.lineHeight};text-shadow:${textHudEdgeShadow};filter:${powerStanceFilter}">${stanceLineHtml}</div>
    </div>
    ${reasonsBlock}
    <div style="margin-top:auto;padding:16px 8px 8px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.12)">
      <div style="min-width:0">
        <span style="display:block;font-size:11px;color:${primary};filter:brightness(1.15) saturate(1.2);text-shadow:${textHudEdgeShadow}">${regionLine}</span>
        <span style="display:block;margin-top:2px;font-size:11px;color:rgba(255,255,255,0.88);text-shadow:${textHudEdgeShadow}">${rankLabel}</span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;flex-shrink:0">
        <img src="${escapeHtml(crownImgUrl)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(168,85,247,0.6))"/>
        <span style="font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#D4AF37;white-space:nowrap;text-shadow:${textHudEdgeShadow};font-family:'GOAT-Display',ui-sans-serif,system-ui,sans-serif">The GOAT Meter</span>
      </div>
    </div>
    <p style="margin:6px 4px 4px;font-size:6px;text-align:center;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.38)">${metaFooterLine}</p>
    <p style="margin:0 4px 8px;font-size:8px;text-align:center;line-height:1.3;color:rgba(255,255,255,0.4)">${disclaimerLine}</p>
  </div>
</div>`;

  const bootScript = `
;(function(){
  function raf2(fn){requestAnimationFrame(function(){requestAnimationFrame(fn);});}
  function markReady(){
    if(!document.getElementById('render-ready-signal')){
      var d=document.createElement('div');
      d.id='render-ready-signal';
      d.style.cssText='position:absolute;width:1px;height:1px;left:0;bottom:0;opacity:0;pointer-events:none';
      document.body.appendChild(d);
    }
  }
  function run(){
    var imgs=[].slice.call(document.images||[]);
    var incomplete=imgs.filter(function(i){return !i.complete;});
    var fontP=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
    if(!incomplete.length){
      fontP.then(function(){raf2(markReady);}).catch(function(){raf2(markReady);});
      return;
    }
    var left=incomplete.length;
    incomplete.forEach(function(i){
      function ok(){left--;if(left<=0)fontP.then(function(){raf2(markReady);}).catch(function(){raf2(markReady);});}
      i.addEventListener('load',ok,{once:true});
      i.addEventListener('error',ok,{once:true});
    });
  }
  run();
})();`;

  const enhancedHead = buildEnhancedHead({
    fontUrl,
    pFF,
    pE6,
    sE6,
    sFF,
    stitch,
    cornerTopRimAlpha,
    cornerBottomRimAlpha,
  });

  return `<!DOCTYPE html><html>${enhancedHead}
<body>
<div id="stage"><div id="scale">${cardInnerHtml}</div></div>
<script>${bootScript}</script>
</body></html>`;
}
