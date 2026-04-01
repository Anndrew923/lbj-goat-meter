import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Media } from "@capacitor-community/media";
import { useTranslation } from "react-i18next";
import crownIcon from "../assets/goat-crown-icon.png";
import { STANCE_COLORS } from "../lib/constants";
import { getStance } from "../i18n/i18n";
import { prepareBattleAssets } from "../utils/svgAssetPreflight";
import { buildBattleReportSvg } from "../utils/battleReportSvgTemplate";

const GOAT_ALBUM_NAME = "GOAT_Warzone";
const EXPORT_SIZE_PX = 1920;
const SVG_DESIGN_SIZE = 1080;
const STRESS_TEST_QUERY_KEY = "stressTest";

function applyExportCanvasQuality(ctx) {
  // 統一匯出引擎參數：每次 drawImage 前先套用，確保多層繪製品質一致。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

function isMediaPluginSavePermissionOk(perm) {
  if (!perm || typeof perm !== "object") return false;
  const ok = (v) => v === "granted" || v === "limited";
  if (ok(perm.photos)) return true;
  if (ok(perm.publicStorage13Plus)) return true;
  if (ok(perm.publicStorage)) return true;
  return false;
}

async function ensureGoatAlbumIdentifier() {
  const list = (await Media.getAlbums())?.albums ?? [];
  let album = list.find((a) => a.name === GOAT_ALBUM_NAME);
  if (!album) {
    await Media.createAlbum({ name: GOAT_ALBUM_NAME });
    await new Promise((r) => setTimeout(r, 350));
    const list2 = (await Media.getAlbums())?.albums ?? [];
    album = list2.find((a) => a.name === GOAT_ALBUM_NAME);
  }
  return album?.identifier;
}

async function showBattleReportSavedToast(text) {
  try {
    const { Toast } = await import("@capacitor/toast");
    await Toast.show({ text, duration: "short", position: "bottom" });
  } catch {
    // ignore toast fail
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg image decode failed"));
    img.src = dataUrl;
  });
}

async function assertExportImageSize(dataUrl) {
  const renderedImage = await loadImage(dataUrl);
  const width = renderedImage.naturalWidth || renderedImage.width;
  const height = renderedImage.naturalHeight || renderedImage.height;
  if (width !== EXPORT_SIZE_PX || height !== EXPORT_SIZE_PX) {
    throw new Error(
      `[battleReportExport] dimension assertion failed: expected ${EXPORT_SIZE_PX}x${EXPORT_SIZE_PX}, got ${width}x${height}`,
    );
  }
}

async function renderSvgMarkupToPngDataUrl(svgMarkup) {
  // [ARCH_LOCK] Pure SVG path. DO NOT re-introduce screenshots.
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const svgBlobUrl = URL.createObjectURL(svgBlob);
  try {
    const decodedSvgImage = await loadImage(svgBlobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE_PX;
    canvas.height = EXPORT_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    applyExportCanvasQuality(ctx);
    ctx.drawImage(decodedSvgImage, 0, 0, SVG_DESIGN_SIZE, SVG_DESIGN_SIZE, 0, 0, EXPORT_SIZE_PX, EXPORT_SIZE_PX);
    return canvas.toDataURL("image/png", 1.0);
  } finally {
    URL.revokeObjectURL(svgBlobUrl);
  }
}

function buildBattleReportInput(safePayload, t) {
  const stanceDisplayName =
    (getStance(safePayload.status)?.primary ?? (safePayload.status ? String(safePayload.status).toUpperCase() : "GOAT"))
      .toUpperCase()
      .trim() || "GOAT";
  const wallText = String(safePayload.voterTeam || "LAL").toUpperCase().trim() || "LAL";
  const regionText = [safePayload.country, safePayload.city].filter(Boolean).join(" · ") || t("global");
  return {
    photoURL: safePayload.photoURL,
    displayName: safePayload.displayName || t("anonymousWarrior"),
    teamColors: safePayload.teamColors,
    stanceColor: safePayload.stanceColor,
    battleSubtitle: safePayload.battleSubtitle || "",
    battleTitle: safePayload.battleTitle || "",
    isTitleUppercase: Boolean(safePayload.isTitleUppercase),
    reasonLabels: Array.isArray(safePayload.reasonLabels) ? safePayload.reasonLabels : [],
    wallText,
    stanceDisplayName,
    teamLineText: safePayload.teamLabel ? String(safePayload.teamLabel).toUpperCase() : "—",
    regionText,
    rankLineText: safePayload.rankLabel || t("rankLabel"),
    brandLine: "The GOAT Meter",
    metaFooterLine: t("globalStats"),
    disclaimerLine: t("disclaimerCommunity"),
  };
}

async function generateBattleReportPngDataUrl(reportInput) {
  const preparedAssets = await prepareBattleAssets({
    photoURL: reportInput.photoURL,
    crownIconSrc: crownIcon,
  });
  if (preparedAssets.avatarDataUri === preparedAssets.fallbackSilhouetteDataUri) {
    console.warn("[battleReportExport] avatar fallback used due to CORS/cache fetch limitation");
  }
  const svgMarkup = buildBattleReportSvg(reportInput, {
    ...preparedAssets,
    colorWash: "",
  });
  try {
    const export1920DataUrl = await renderSvgMarkupToPngDataUrl(svgMarkup);
    await assertExportImageSize(export1920DataUrl);
    return export1920DataUrl;
  } catch (error) {
    throw new Error(`[battleReportExport] SVG render failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildStressTestPayload(t) {
  return {
    photoURL: "",
    displayName: "THE-LONGEST-LEGACY-NAME-OF-THE-ARENA-CHAMPION-2026",
    voterTeam: "LAL",
    teamLabel: "LAKERS ELITE SUPPORTERS CHAPTER",
    status: "goat",
    reasonLabels: ["Playmaking gravity", "Playoff durability", "Era-defining IQ"],
    city: "Los Angeles",
    country: "USA",
    rankLabel: t("rankLabel"),
    teamColors: { primary: "#FF0000", secondary: "#BF57FF" },
    battleTitle:
      "THE KING REWRITES BASKETBALL HISTORY WITH TWO-LINE PRESSURE TEST FOR VERTICAL FLOW",
    battleSubtitle: "STRESS TEST MODE",
    warzoneStats: null,
    isTitleUppercase: true,
    fileBaseWeb: `GOAT-Stress-Test-${Date.now()}`,
  };
}

export default function BattleCardExportScene() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(true);
  const runningRef = useRef(false);
  const stressTestMode = import.meta.env.DEV && new URLSearchParams(location.search).get(STRESS_TEST_QUERY_KEY) === "1";
  const exportPayload = location.state?.exportPayload ?? (stressTestMode ? buildStressTestPayload(t) : null);
  const action = location.state?.action === "download" ? "download" : "save";
  const returnTo = typeof location.state?.returnTo === "string" ? location.state.returnTo : "/vote";

  const safePayload = useMemo(() => {
    if (!exportPayload) return null;
    const status = exportPayload.status;
    const stanceColor = status
      ? (STANCE_COLORS[status] ?? STANCE_COLORS.goat)
      : (exportPayload.stanceColor ?? STANCE_COLORS.goat);
    return {
      ...exportPayload,
      stanceColor,
      isExportReady: true,
      arenaAnimationsPaused: true,
      onRequestRewardAd: undefined,
      onExportUnlock: undefined,
      onExportStart: undefined,
      onExportEnd: undefined,
    };
  }, [exportPayload]);

  useEffect(() => {
    if (!safePayload || runningRef.current) return;
    runningRef.current = true;

    const run = async () => {
      try {
        const isNative = Capacitor.isNativePlatform();
        if (isNative && action === "save" && typeof Media.checkPermissions === "function") {
          const check = await Media.checkPermissions();
          if (!isMediaPluginSavePermissionOk(check)) {
            const request = await Media.requestPermissions();
            if (!isMediaPluginSavePermissionOk(request)) {
              console.warn("[BattleCardExportScene] save permission denied");
              navigate(returnTo, { replace: true });
              return;
            }
          }
        }

        const reportInput = buildBattleReportInput(safePayload, t);
        const export1920DataUrl = await generateBattleReportPngDataUrl(reportInput);

        if (action === "save") {
          const albumIdentifier = await ensureGoatAlbumIdentifier();
          await Media.savePhoto({
            path: export1920DataUrl,
            albumIdentifier: albumIdentifier ?? GOAT_ALBUM_NAME,
            fileName: `GOAT-Card-${Date.now()}`,
          });
          await showBattleReportSavedToast(t("battleReportSavedToGallery"));
        } else {
          const a = document.createElement("a");
          a.href = export1920DataUrl;
          const fileBase = safePayload.fileBaseWeb || `GOAT-Card-${Date.now()}`;
          a.download = `${fileBase}.png`;
          a.click();
        }
      } catch (err) {
        console.error("[BattleCardExportScene] SVG export failed", err);
      } finally {
        setIsRunning(false);
        navigate(returnTo, { replace: true });
      }
    };

    run();
  }, [safePayload, action, navigate, returnTo, t]);
  if (!safePayload) return null;

  return (
    <div className="fixed inset-0 z-[12000] bg-black flex items-center justify-center overflow-hidden">
      {stressTestMode ? (
        <div className="absolute top-4 left-4 px-2 py-1 rounded bg-white/10 text-white/70 text-xs">
          Stress Test Mode
        </div>
      ) : null}
      {isRunning ? (
        <div className="absolute bottom-6 text-white/70 text-sm">{t("generatingHighResReport")}</div>
      ) : null}
    </div>
  );
}
