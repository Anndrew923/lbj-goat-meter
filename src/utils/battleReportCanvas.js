import crownIcon from "../assets/goat-crown-icon.png";
import { buildBattleReportSvg } from "./battleReportSvgTemplate";
import { prepareBattleAssets } from "./svgAssetPreflight";

/**
 * LEGACY PIPELINE:
 * - Native App 主線已切換為 BattleCardExportScene + capacitor-screenshot（DOM 單一事實來源）
 * - 本檔保留給 Web 端匯出與原生備援路徑，不再追求與 BattleCard DOM 視覺逐像素同步。
 */
/** PNG 輸出像素（SVG 仍為 1080 viewBox，drawImage 放大至此解析度） */
export const BATTLE_CARD_EXPORT_SIZE = 1920;
export const BATTLE_CARD_DESIGN_SIZE = 1080;

/**
 * 保留字體預載流程，避免 SVG text 在首輪匯出時回退到系統字體。
 */
async function ensureDocumentFontsReady() {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
}

function loadImageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      if (typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          // keep loaded pixels
        }
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error("[battleReportCanvas] failed to decode SVG image"));
    img.src = url;
  });
}

/**
 * @typedef {Object} BattleReportCanvasInput
 * @property {{ primary: string, secondary: string }} teamColors
 * @property {string} stanceColor
 * @property {string} battleTitle
 * @property {string} battleSubtitle
 * @property {string} displayName
 * @property {string} teamLineText
 * @property {string} regionText
 * @property {string} [locationLine]
 * @property {string} rankLineText
 * @property {string[]} reasonLabels
 * @property {string} stanceDisplayName
 * @property {string} wallText
 * @property {string} [photoURL]
 * @property {string} metaFooterLine
 * @property {string} disclaimerLine
 * @property {string} evidenceLabel
 * @property {string} brandLine
 * @property {boolean} isTitleUppercase
 * @property {"standard"|"warzone"|"overdrive"} [visualPreset]
 */

/**
 * SVG 模板匯出主流程：
 * 1) 資源預處理 -> 2) 建立 SVG -> 3) Rasterize 到 BATTLE_CARD_EXPORT_SIZE 正方形 Canvas。
 *
 * @param {BattleReportCanvasInput} input
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateBattleReportCanvas(input) {
  await ensureDocumentFontsReady();

  const assets = await prepareBattleAssets({
    photoURL: input.photoURL,
    crownIconSrc: typeof crownIcon === "string" ? crownIcon : crownIcon?.src ?? "",
  });

  const svgString = buildBattleReportSvg(input, assets);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImageFromObjectUrl(url);
    const canvas = document.createElement("canvas");
    canvas.width = BATTLE_CARD_EXPORT_SIZE;
    canvas.height = BATTLE_CARD_EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("[battleReportCanvas] 2d context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, BATTLE_CARD_EXPORT_SIZE, BATTLE_CARD_EXPORT_SIZE);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {BattleReportCanvasInput} input
 * @returns {Promise<string>} data URL (PNG)
 */
export async function generateBattleReportPngDataUrl(input) {
  const canvas = await generateBattleReportCanvas(input);
  return canvas.toDataURL("image/png", 1.0);
}
