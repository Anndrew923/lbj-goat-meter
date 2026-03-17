/**
 * 客戶端圖片壓縮與 WebP 轉檔 — 用於 Firebase Storage 上傳前預處理
 *
 * 設計意圖：
 * - 降低儲存與流量成本：強制 16:9、解析度上限 1280px、品質 0.75，目標單張 150–200KB 以內。
 * - 純 Canvas 實作，無額外依賴；輸出統一為 image/webp 以利長效快取。
 *
 * 潛在影響：不支援 WebP 的極舊瀏覽器無法在此端轉檔（可 fallback 為原圖上傳或服務端轉檔）。
 */

/** 目標比例 16:9 */
const TARGET_RATIO = 16 / 9
/** 寬度上限（720p 對應高度 720） */
const MAX_WIDTH = 1280
/** WebP 品質（0.7–0.8 平衡清晰度與體積） */
const WEBP_QUALITY = 0.75

/**
 * 將圖片裁切為 16:9（置中）、縮放至寬度 ≤ MAX_WIDTH，並輸出為 WebP Blob。
 * @param {File} file - 使用者選擇的圖片檔（任意 image/*）
 * @returns {Promise<Blob>} - image/webp 的 Blob，可直接上傳至 Storage
 */
export function compressAndConvertToWebP(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Invalid file type: expected image'))
      return
    }
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const srcW = img.naturalWidth || img.width
        const srcH = img.naturalHeight || img.height
        if (!srcW || !srcH) {
          reject(new Error('Invalid image dimensions'))
          return
        }
        const srcRatio = srcW / srcH

        // 以來源圖置中裁切出 16:9 區域
        let cropW, cropH, cropX, cropY
        if (srcRatio > TARGET_RATIO) {
          cropH = srcH
          cropW = srcH * TARGET_RATIO
          cropX = (srcW - cropW) / 2
          cropY = 0
        } else {
          cropW = srcW
          cropH = srcW / TARGET_RATIO
          cropX = 0
          cropY = (srcH - cropH) / 2
        }

        const scale = Math.min(1, MAX_WIDTH / cropW)
        const outW = Math.max(1, Math.round(cropW * scale))
        const outH = Math.max(1, Math.round(cropH * scale))

        const canvas = document.createElement('canvas')
        canvas.width = outW
        canvas.height = outH
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2d context not available'))
          return
        }
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH)

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas toBlob failed'))
          },
          'image/webp',
          WEBP_QUALITY
        )
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image load failed'))
    }
    img.src = objectUrl
  })
}
