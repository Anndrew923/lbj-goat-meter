/**
 * 觸覺回饋工具：使用 Vibration API，在支援的裝置（多為手機）上觸發震動。
 * 不支援時靜默略過，無副作用。
 * @param {number | number[]} [pattern=10] - 震動毫秒數，或 [震動, 間隔, 震動, ...] 陣列
 */
export function triggerHaptic(pattern = 10) {
  if (
    typeof window === "undefined" ||
    !window.navigator?.vibrate
  ) {
    return;
  }
  window.navigator.vibrate(pattern);
}
