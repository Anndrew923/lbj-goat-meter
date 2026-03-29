import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Dialog } from "@capacitor/dialog";
import { Media } from "@capacitor-community/media";
import { Screenshot } from "capacitor-screenshot";
import { useTranslation } from "react-i18next";
import { STANCE_COLORS } from "../lib/constants";
import BattleCard from "../components/BattleCard";

const GOAT_ALBUM_NAME = "GOAT_Warzone";
const EXPORT_SIZE_PX = 1080;

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

function normalizeScreenshotDataUrl(result) {
  if (!result) return "";
  if (typeof result.base64 === "string" && result.base64) return `data:image/png;base64,${result.base64}`;
  if (typeof result.webPath === "string" && result.webPath) return result.webPath;
  if (typeof result.path === "string" && result.path) return result.path;
  return "";
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("screenshot decode failed"));
    img.src = dataUrl;
  });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

async function cropScreenshotToExportSquare(rawScreenshotDataUrl, exportRect) {
  const img = await loadImage(rawScreenshotDataUrl);
  const viewportW = Math.max(1, window.innerWidth);
  const viewportH = Math.max(1, window.innerHeight);
  const scaleX = img.width / viewportW;
  const scaleY = img.height / viewportH;
  const sx = clamp(Math.round(exportRect.left * scaleX), 0, img.width - 1);
  const sy = clamp(Math.round(exportRect.top * scaleY), 0, img.height - 1);
  const sw = clamp(Math.round(exportRect.width * scaleX), 1, img.width - sx);
  const sh = clamp(Math.round(exportRect.height * scaleY), 1, img.height - sy);

  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE_PX;
  canvas.height = EXPORT_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, EXPORT_SIZE_PX, EXPORT_SIZE_PX);
  return canvas.toDataURL("image/png", 1.0);
}

export default function BattleCardExportScene() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(true);
  const runningRef = useRef(false);
  const exportSquareRef = useRef(null);
  const exportPayload = location.state?.exportPayload ?? null;
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
      if (!Capacitor.isNativePlatform()) {
        navigate(returnTo, { replace: true });
        return;
      }

      try {
        if (typeof Media.checkPermissions === "function") {
          const check = await Media.checkPermissions();
          if (!isMediaPluginSavePermissionOk(check)) {
            const request = await Media.requestPermissions();
            if (!isMediaPluginSavePermissionOk(request)) {
              await Dialog.alert({
                title: t("galleryPermissionTitle"),
                message: t("needPhotoPermissionToSave"),
              });
              navigate(returnTo, { replace: true });
              return;
            }
          }
        }

        if (typeof document !== "undefined" && document.fonts?.ready) {
          await document.fonts.ready;
        }
        // Smart Wait: fonts ready + 2 frames，確保霓虹濾鏡完成合成後再快門。
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 120));

        const screenshot = await Screenshot.take();
        const screenshotData = normalizeScreenshotDataUrl(screenshot);
        const exportRect = exportSquareRef.current?.getBoundingClientRect?.();
        if (!screenshotData || !exportRect || exportRect.width <= 0 || exportRect.height <= 0) {
          await Dialog.alert({
            title: t("exportFailedTitle"),
            message: t("exportFailedNativeRenderAnomalyAdvice"),
          });
          navigate(returnTo, { replace: true });
          return;
        }
        const cropped1080DataUrl = await cropScreenshotToExportSquare(screenshotData, exportRect);

        if (action === "save") {
          const albumIdentifier = await ensureGoatAlbumIdentifier();
          await Media.savePhoto({
            path: cropped1080DataUrl,
            albumIdentifier: albumIdentifier ?? GOAT_ALBUM_NAME,
            fileName: `GOAT-Card-${Date.now()}`,
          });
          await showBattleReportSavedToast(t("battleReportSavedToGallery"));
        } else {
          const a = document.createElement("a");
          a.href = cropped1080DataUrl;
          a.download = `GOAT-Card-${Date.now()}.png`;
          a.click();
        }
      } catch (err) {
        await Dialog.alert({
          title: t("exportFailedTitle"),
          message: t("exportFailedNativeRenderAnomalyAdvice"),
        });
        console.error("[BattleCardExportScene] capture failed", err);
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
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <div
          ref={exportSquareRef}
          style={{
            width: `${EXPORT_SIZE_PX}px`,
            height: `${EXPORT_SIZE_PX}px`,
          }}
        >
          <BattleCard
            open
            onClose={() => {}}
            onRevote={undefined}
            revoking={false}
            revoteError={null}
            onRevoteReload={undefined}
            photoURL={safePayload.photoURL}
            displayName={safePayload.displayName}
            voterTeam={safePayload.voterTeam}
            teamLabel={safePayload.teamLabel}
            status={safePayload.status}
            reasonLabels={safePayload.reasonLabels}
            city={safePayload.city}
            country={safePayload.country}
            rankLabel={safePayload.rankLabel}
            exit={{ opacity: 1, scale: 1 }}
            teamColors={safePayload.teamColors}
            battleTitle={safePayload.battleTitle}
            battleSubtitle={safePayload.battleSubtitle}
            warzoneStats={safePayload.warzoneStats}
            isTitleUppercase={safePayload.isTitleUppercase}
            isExportReady
            onExportUnlock={undefined}
            onRequestRewardAd={undefined}
            onExportStart={undefined}
            onExportEnd={undefined}
            arenaAnimationsPaused
            exportSceneMode
            disablePortal
          />
        </div>
      </div>
      {isRunning ? (
        <div className="absolute bottom-6 text-white/70 text-sm">{t("generatingHighResReport")}</div>
      ) : null}
    </div>
  );
}
