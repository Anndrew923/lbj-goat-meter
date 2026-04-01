import { toPng } from "html-to-image";

/** 與 BattleCard.jsx CARD_SIZE 一致：設計稿像素（固定邏輯座標，與手機螢幕 scale 無關） */
export const BATTLE_CARD_DOM_SIZE = 640;
/** 匯出 PNG 邊長 */
export const BATTLE_CARD_EXPORT_SIZE = 1920;

function waitFrames(n) {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      i += 1;
      if (i >= n) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * 預覽時卡片在「縮放後的方盒 + overflow:hidden」內用 transform 置中；
 * 若不先還原版面，html-to-image 在部分 WebView 會裁切錯位或與預覽不符。
 * 此處暫時把外殼固定為 640×640 並取消 transform，再擷取。
 */
function applyExportLayoutPatch(element) {
  const shell = element.parentElement;
  if (!shell) return null;

  const snapshot = {
    shell: {
      width: shell.style.width,
      height: shell.style.height,
      overflow: shell.style.overflow,
      position: shell.style.position,
    },
    el: {
      transform: element.style.transform,
      transformOrigin: element.style.transformOrigin,
      left: element.style.left,
      top: element.style.top,
      right: element.style.right,
      bottom: element.style.bottom,
      position: element.style.position,
      width: element.style.width,
      height: element.style.height,
      margin: element.style.margin,
    },
  };

  const px = `${BATTLE_CARD_DOM_SIZE}px`;
  shell.style.width = px;
  shell.style.height = px;
  shell.style.overflow = "visible";
  shell.style.position = "relative";

  element.style.transform = "none";
  element.style.transformOrigin = "top left";
  element.style.left = "0";
  element.style.top = "0";
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.position = "relative";
  element.style.width = px;
  element.style.height = px;
  element.style.margin = "0";

  return snapshot;
}

function restoreExportLayoutPatch(element, snapshot) {
  if (!snapshot) return;
  const { shell, el } = snapshot;
  const sh = element.parentElement;
  if (sh) {
    sh.style.width = shell.width;
    sh.style.height = shell.height;
    sh.style.overflow = shell.overflow;
    sh.style.position = shell.position;
  }
  element.style.transform = el.transform;
  element.style.transformOrigin = el.transformOrigin;
  element.style.left = el.left;
  element.style.top = el.top;
  element.style.right = el.right;
  element.style.bottom = el.bottom;
  element.style.position = el.position;
  element.style.width = el.width;
  element.style.height = el.height;
  element.style.margin = el.margin;
}

/**
 * 從戰報卡根節點擷取 PNG Data URL（與預覽同一 DOM；匯出座標固定 640 邏輯像素）。
 */
export async function captureBattleCardToPngDataUrl(element) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("[battleCardDomExport] capture target must be an HTMLElement");
  }

  const snapshot = applyExportLayoutPatch(element);
  try {
    // 多幀：讓 WebView / Safari 完成 reflow 再畫進 canvas
    await waitFrames(3);

    const pixelRatio = BATTLE_CARD_EXPORT_SIZE / BATTLE_CARD_DOM_SIZE;
    return await toPng(element, {
      width: BATTLE_CARD_DOM_SIZE,
      height: BATTLE_CARD_DOM_SIZE,
      pixelRatio,
      cacheBust: true,
      // 跳過遠端 @font-face 抓取，避免瀏覽器因跨域 CSS 規則拒絕而報錯
      skipFonts: true,
      style: {},
    });
  } finally {
    restoreExportLayoutPatch(element, snapshot);
  }
}
