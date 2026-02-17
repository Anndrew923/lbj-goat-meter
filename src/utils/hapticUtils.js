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

/**
 * 依序執行 pattern 震動（原生端用多段 vibrate + 延遲模擬 [震, 停, 震, ...]）
 * @param {number[]} pattern - [震動ms, 間隔ms, 震動ms, ...]，例如 [30, 50, 30]、[20, 40, 20]
 */
export async function triggerHapticPattern(pattern) {
  if (typeof window === "undefined" || !Array.isArray(pattern) || pattern.length === 0) return;

  if (Capacitor.isNativePlatform()) {
    try {
      for (let i = 0; i < pattern.length; i++) {
        if (i % 2 === 0) {
          const duration = pattern[i];
          if (typeof duration === "number" && duration > 0) await Haptics.vibrate({ duration });
        } else {
          const pauseMs = pattern[i];
          if (typeof pauseMs === "number" && pauseMs > 0)
            await new Promise((r) => setTimeout(r, pauseMs));
        }
      }
    } catch {
      // 無震動硬體或權限時靜默略過
    }
    return;
  }

  if (window.navigator?.vibrate) {
    window.navigator.vibrate(pattern);
  }
}
