/**
 * 觸覺回饋工具：在原生 App（Android/iOS）使用 Capacitor Haptics.vibrate()，
 * 在 Web 使用 Vibration API。不支援時靜默略過，無副作用。
 * @param {number | number[]} [pattern=10] - 震動毫秒數，或 [震動, 間隔, 震動, ...] 陣列（陣列時僅取首段時長給 Haptics）
 * @returns {Promise<void>}
 */
import { Capacitor } from "@capacitor/core";
import { Haptics } from "@capacitor/haptics";

const DEFAULT_DURATION_MS = 10;

export async function triggerHaptic(pattern = DEFAULT_DURATION_MS) {
  if (typeof window === "undefined") return;

  const durationMs = Array.isArray(pattern) ? pattern[0] ?? DEFAULT_DURATION_MS : pattern;
  const duration =
    typeof durationMs === "number" && durationMs > 0 ? durationMs : DEFAULT_DURATION_MS;

  if (Capacitor.isNativePlatform()) {
    try {
      await Haptics.vibrate({ duration });
    } catch {
      // 無震動硬體或權限時靜默略過
    }
    return;
  }

  if (window.navigator?.vibrate) {
    window.navigator.vibrate(pattern);
  }
}
