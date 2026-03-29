/**
 * AvatarService — 使用者頭像鏡像至 Firebase Storage
 *
 * 設計意圖：
 * - 避免直接在 Canvas / html-to-image 中載入 googleusercontent.com 等外部頭像導致 CORS 汙染。
 * - 於登入階段將 Google 頭像備份到專案自有的 Storage bucket（已設定 CORS），後續統一使用此來源。
 * - 僅在偵測到外部來源時嘗試鏡像，且失敗時靜默回落為原始 photoURL，避免阻塞登入流程。
 * - 成功時由 AuthContext 另將回傳 URL 寫入 Firestore profiles.photoURL（setDoc merge），與資料庫持久同步。
 */
import { storage } from "../lib/firebase";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

const GOOGLE_HOST_HINT = "googleusercontent.com";

function isStorageAvatarUrl(url, uid) {
  if (typeof url !== "string" || !url) return false;
  if (!uid) return false;
  // 粗略偵測：Firebase Storage 下載網址且路徑包含 avatars%2F{uid}
  if (!url.startsWith("https://firebasestorage.googleapis.com/")) return false;
  const encodedPrefix = encodeURIComponent(`avatars/${uid}/`);
  return url.includes(`/o/${encodedPrefix}`);
}

function shouldMirror(url) {
  if (typeof url !== "string" || !url) return false;
  // 目前主要風險來源：Google 大頭貼（googleusercontent.com）
  if (url.includes(GOOGLE_HOST_HINT)) return true;
  // 其餘第三方來源視未來需求再擴充；默認不鏡像以節省頻寬。
  return false;
}

/**
 * Storage metadata 必須為明確的 image/jpeg 或 image/png，避免 Content-Type 缺失／octet-stream
 * 導致下載行為或 Canvas 解碼異常。
 */
function resolveAvatarContentType(blob, resp) {
  const fromBlob = blob.type?.split(";")[0]?.trim() ?? "";
  const fromHeader = resp.headers?.get?.("Content-Type")?.split(";")[0]?.trim() ?? "";
  let raw = fromBlob && fromBlob !== "application/octet-stream" ? fromBlob : fromHeader;
  if (!raw || raw === "application/octet-stream") {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (raw === "image/jpg") {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (raw === "image/png") {
    return { contentType: "image/png", ext: "png" };
  }
  if (raw === "image/jpeg") {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  // 其餘 image/*（如 webp）仍上傳，但副檔名與 MIME 對齊；html-to-image 需解碼則以瀏覽器支援為準
  if (raw.startsWith("image/")) {
    const sub = raw.slice("image/".length) || "jpeg";
    return { contentType: raw, ext: sub === "jpeg" ? "jpg" : sub };
  }
  return { contentType: "image/jpeg", ext: "jpg" };
}

export async function ensureAvatarInStorage({ uid, photoURL }) {
  if (!uid || !photoURL || !storage) return null;

  if (isStorageAvatarUrl(photoURL, uid)) {
    return photoURL;
  }

  if (!shouldMirror(photoURL)) {
    return null;
  }

  try {
    const resp = await fetch(photoURL, { mode: "cors" });
    if (!resp.ok) {
      throw new Error(`avatar fetch failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    const { contentType, ext } = resolveAvatarContentType(blob, resp);
    const objectRef = ref(storage, `avatars/${uid}/avatar.${ext}`);
    await uploadBytes(objectRef, blob, {
      contentType,
      cacheControl: "public,max-age=31536000,immutable",
    });
    const downloadURL = await getDownloadURL(objectRef);
    return downloadURL || null;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[AvatarService] mirror avatar failed, fallback to original URL:", err);
    }
    return null;
  }
}

