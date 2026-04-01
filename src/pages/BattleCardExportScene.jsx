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

async function takeViewportScreenshotDataUrl() {
  const screenshot = await Screenshot.take();
  return normalizeScreenshotDataUrl(screenshot);
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

function getViewportSnapshot() {
  const vv = window.visualViewport;
  if (!vv) {
    return {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      offsetLeft: 0,
      offsetTop: 0,
    };
  }
  return {
    width: Math.max(1, vv.width),
    height: Math.max(1, vv.height),
    offsetLeft: vv.offsetLeft ?? 0,
    offsetTop: vv.offsetTop ?? 0,
  };
}

async function cropScreenshotToExportSquare(rawScreenshotDataUrl, exportRect, viewport) {
  const img = await loadImage(rawScreenshotDataUrl);
  const scaleX = img.width / viewport.width;
  const scaleY = img.height / viewport.height;
  const sx = clamp(Math.round((exportRect.left + viewport.offsetLeft) * scaleX), 0, img.width - 1);
  const sy = clamp(Math.round((exportRect.top + viewport.offsetTop) * scaleY), 0, img.height - 1);
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

async function waitFrames(count) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}

export default function BattleCardExportScene() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(true);
  const runningRef = useRef(false);
  const exportSquareRef = useRef(null);
  const exportCardRectRef = useRef(null);
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
      try {
        if (!Capacitor.isNativePlatform()) {
          await Dialog.alert({
            title: t("exportFailedTitle"),
            message: t("exportFailedNativeRenderAnomalyAdvice"),
          });
          navigate(returnTo, { replace: true });
          return;
        }
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
        // Smart Wait: fonts ready + multi-frame，確保濾鏡合成與最終版面穩定。
        await waitFrames(3);
        await new Promise((r) => setTimeout(r, 120));

        let cropped1080DataUrl = "";
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
                    await waitFrames(2 + attempt);
            const exportRect = exportCardRectRef.current?.getBoundingClientRect?.();
            if (!exportRect || exportRect.width <= 0 || exportRect.height <= 0) {
              throw new Error("invalid export rect");
            }
            const viewport = getViewportSnapshot();
            const screenshotData = await takeViewportScreenshotDataUrl();
            if (!screenshotData) throw new Error("empty screenshot data");
            cropped1080DataUrl = await cropScreenshotToExportSquare(screenshotData, exportRect, viewport);
            if (cropped1080DataUrl) break;
          } catch (e) {
            lastError = e;
          }
        }
        if (!cropped1080DataUrl) throw lastError ?? new Error("capture retry exhausted");

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
          const fileBase = safePayload.fileBaseWeb || `GOAT-Card-${Date.now()}`;
          a.download = `${fileBase}.png`;
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

  useEffect(() => {
    if (!safePayload) return;
    const root = exportSquareRef.current;
    if (!root) return;
    const syncCardRectTarget = () => {
      const card = root.querySelector('[data-ref="battle-card-ref"]');
      exportCardRectRef.current = card instanceof HTMLElement ? card : null;
    };
    syncCardRectTarget();
    const observer = new MutationObserver(syncCardRectTarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [safePayload]);

  if (!safePayload) return null;

  return (
    <div className="fixed inset-0 z-[12000] bg-black flex items-center justify-center overflow-hidden">
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <div
          ref={exportSquareRef}
          style={{
            width: `${EXPORT_SIZE_PX}px`,
            height: `${EXPORT_SIZE_PX}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
