/**
 * 戰報卡寫入系統相簿（Capacitor 原生）。
 * Web 仍用 BattleCardExportScene 的 anchor/blob 下載；APK／iOS WebView 不會可靠觸發「下載到相簿」。
 */
import { Capacitor } from "@capacitor/core";
import { Media } from "@capacitor-community/media";
import { Dialog } from "@capacitor/dialog";
import { Toast } from "@capacitor/toast";
import { Directory, Filesystem } from "@capacitor/filesystem";

export function isMediaPluginSavePermissionOk(perm) {
  if (!perm || typeof perm !== "object") return false;
  const ok = (v) => v === "granted" || v === "limited";
  if (ok(perm.photos)) return true;
  if (ok(perm.publicStorage13Plus)) return true;
  if (ok(perm.publicStorage)) return true;
  return false;
}

async function ensureGallerySavePermission(t) {
  if (!Capacitor.isNativePlatform()) return true;
  if (typeof Media.checkPermissions !== "function") return true;
  const check = await Media.checkPermissions();
  if (isMediaPluginSavePermissionOk(check)) return true;
  const request = await Media.requestPermissions();
  if (isMediaPluginSavePermissionOk(request)) return true;
  await Dialog.alert({
    title: t("galleryPermissionTitle"),
    message: t("needPhotoPermissionToSave"),
  });
  return false;
}

/**
 * Android：savePhoto 需 albumIdentifier（見 Media 插件 Java 實作）。
 * 不可使用 getAlbums() 任意一筆：MediaStore 回傳的 parent 可能是 /product/... 等唯讀路徑，
 * 寫入會出現 EROFS（與「Pictures」相簿名稱匹配無關）。
 * 一律使用 getAlbumsPath()（getExternalMediaDirs()[0]，可寫）+ createAlbum('GOAT Meter')。
 */
async function resolveAndroidAlbumIdentifier() {
  const { path: basePath } = await Media.getAlbumsPath();
  if (!basePath || typeof basePath !== "string") {
    throw new Error("NoWritableAlbum");
  }
  const albumLabel = "GOAT Meter";
  try {
    await Media.createAlbum({ name: albumLabel });
  } catch {
    /* 資料夾已存在時插件會 reject，路徑仍可用 */
  }
  const normalized = basePath.replace(/[/\\]+$/, "");
  const sep = basePath.includes("\\") ? "\\" : "/";
  return `${normalized}${sep}${albumLabel}`;
}

async function saveWithDataUriAndroid({ dataUri }) {
  const albumIdentifier = await resolveAndroidAlbumIdentifier();
  await Media.savePhoto({
    path: dataUri,
    albumIdentifier,
    fileName: `GOAT-Meter-${Date.now()}`,
  });
}

async function saveWithHttpsUrlAndroid({ url }) {
  const albumIdentifier = await resolveAndroidAlbumIdentifier();
  await Media.savePhoto({
    path: url,
    albumIdentifier,
    fileName: `GOAT-Meter-${Date.now()}`,
  });
}

/** iOS：data: 走 SDWebImage 下載易失敗，改寫入 Cache 再以 file URI 交給 savePhoto。 */
async function saveWithBase64IOS({ rawBase64 }) {
  const fname = `goat-battle-${Date.now()}.jpg`;
  await Filesystem.writeFile({
    path: fname,
    directory: Directory.Cache,
    data: rawBase64,
  });
  const { uri } = await Filesystem.getUri({ path: fname, directory: Directory.Cache });
  await Media.savePhoto({ path: uri });
  try {
    await Filesystem.deleteFile({ path: fname, directory: Directory.Cache });
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * @param {object} params
 * @param {function(string): string} params.t — common namespace `t`
 * @param {string} [params.rawBase64] — 純 base64（無 data: 前綴）
 * @param {string} [params.mimeType]
 * @param {string} [params.httpsUrl] — 無 base64 時由後端回傳的 URL（Android 端內 OkHttp 下載）
 */
export async function saveBattleReportToNativeGallery({ t, rawBase64, mimeType = "image/jpeg", httpsUrl }) {
  if (!Capacitor.isNativePlatform()) return;

  const allowed = await ensureGallerySavePermission(t);
  if (!allowed) {
    const err = new Error("gallery-permission-denied");
    err.code = "gallery-permission-denied";
    throw err;
  }

  const platform = Capacitor.getPlatform();

  if (typeof rawBase64 === "string" && rawBase64.length > 0) {
    const dataUri = `data:${mimeType};base64,${rawBase64}`;
    if (platform === "android") {
      await saveWithDataUriAndroid({ dataUri });
    } else {
      await saveWithBase64IOS({ rawBase64 });
    }
  } else if (typeof httpsUrl === "string" && /^https?:\/\//i.test(httpsUrl)) {
    if (platform === "android") {
      await saveWithHttpsUrlAndroid({ url: httpsUrl });
    } else {
      await Media.savePhoto({ path: httpsUrl });
    }
  } else {
    throw new Error("Native gallery save: missing image payload");
  }

  try {
    await Toast.show({ text: t("battleReportSavedToGallery"), duration: "short" });
  } catch {
    /* Toast 失敗不阻斷成功路徑 */
  }
}
