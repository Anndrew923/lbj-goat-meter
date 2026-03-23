/**
 * 將 global_events 的 title/description 轉成 FCM notification 用的單一字串。
 * UniversalAdmin 寫入為 { en, 'zh-TW' }；舊資料或手動文件可能為純字串。
 *
 * 優先順序（設計意圖）：zh-TW 優先服務台灣用戶 → en → 物件上其餘非空字串鍵。
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function resolveBreakingEventLocalizedText(value, fallback) {
  const safeFallback = typeof fallback === "string" ? fallback : "";

  if (typeof value === "string") {
    const s = value.trim();
    return s || safeFallback;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const zhTW = typeof value["zh-TW"] === "string" ? value["zh-TW"].trim() : "";
    if (zhTW) return zhTW;

    const en = typeof value.en === "string" ? value.en.trim() : "";
    if (en) return en;

    for (const key of Object.keys(value)) {
      if (key === "zh-TW" || key === "en") continue;
      const v = value[key];
      if (typeof v === "string") {
        const t = v.trim();
        if (t) return t;
      }
    }
  }

  return safeFallback;
}
