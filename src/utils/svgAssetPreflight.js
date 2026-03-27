const fetchDataUrlCache = new Map();

const FALLBACK_SILHOUETTE_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#707078" />
        <stop offset="100%" stop-color="#34343a" />
      </linearGradient>
    </defs>
    <rect width="256" height="256" fill="url(#bg)" />
    <circle cx="128" cy="102" r="52" fill="rgba(0,0,0,0.28)" />
    <ellipse cx="128" cy="218" rx="84" ry="64" fill="rgba(0,0,0,0.34)" />
  </svg>`,
)}`;

const FALLBACK_CROWN_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="40" fill="#2f2f34" />
    <path
      d="M48 172l18-84 52 40 38-56 40 56 26-40 18 84H48z"
      fill="#8f8f97"
      stroke="#b7b7bf"
      stroke-width="7"
      stroke-linejoin="round"
    />
    <rect x="64" y="172" width="128" height="20" rx="8" fill="#7f7f87" />
  </svg>`,
)}`;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:")) {
        resolve(result);
        return;
      }
      reject(new Error("[svgAssetPreflight] failed to convert blob to data URI"));
    };
    reader.onerror = () => reject(new Error("[svgAssetPreflight] FileReader error"));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(src) {
  if (!src || typeof src !== "string") {
    throw new Error("[svgAssetPreflight] invalid image source");
  }
  if (src.startsWith("data:")) return src;
  const cached = fetchDataUrlCache.get(src);
  if (cached) return cached;
  const response = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`[svgAssetPreflight] image fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  fetchDataUrlCache.set(src, dataUrl);
  return dataUrl;
}

/**
 * 將外部圖片預先轉為 Data URI，避免 iOS/Safari 在 SVG 畫到 Canvas 時觸發 tainted canvas。
 * 設計意圖：所有圖片資源統一在進模板前完成降噪與 fallback，讓渲染層保持純函式。
 */
export async function prepareBattleAssets({ photoURL, crownIconSrc }) {
  const [avatarDataUri, crownDataUri] = await Promise.all([
    fetchAsDataUrl(photoURL).catch(() => FALLBACK_SILHOUETTE_DATA_URI),
    fetchAsDataUrl(crownIconSrc).catch(() => FALLBACK_CROWN_DATA_URI),
  ]);
  return {
    avatarDataUri,
    crownDataUri,
    fallbackSilhouetteDataUri: FALLBACK_SILHOUETTE_DATA_URI,
    fallbackCrownDataUri: FALLBACK_CROWN_DATA_URI,
  };
}
