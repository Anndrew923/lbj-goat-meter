import { Capacitor } from "@capacitor/core";
import { FacebookAnalytics } from "@jonit-dev/capacitor-plugin-facebook-analytics";

/**
 * MetaAnalyticsService
 *
 * 設計意圖：
 * - 統一封裝 Meta 事件，避免業務模組直接耦合第三方 SDK。
 * - 僅在原生平台送出事件，Web 環境保持 no-op，避免測試與 SSR/瀏覽器報錯。
 * - 任何 SDK 例外只記錄不拋出，確保主流程（登入、投票）不受追蹤失敗影響。
 */
function canTrack() {
  return Capacitor.isNativePlatform();
}

async function safeTrack(trackFn, eventName) {
  if (!canTrack()) return false;
  try {
    await trackFn();
    return true;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[MetaAnalyticsService] ${eventName} track failed:`, err?.message ?? err);
    }
    return false;
  }
}

export async function trackCompleteRegistration({
  registrationMethod = "google",
  userId,
} = {}) {
  return safeTrack(
    () =>
      FacebookAnalytics.logCompleteRegistration({
        params: {
          method: registrationMethod,
          user_id: userId ?? "",
        },
      }),
    "CompleteRegistration"
  );
}

export async function trackSubmitVote({
  starId = "lbj",
  stance,
  warzoneId,
  reasonCount,
} = {}) {
  // 僅追蹤 LBJ 議題票券，避免演算法被其他主題噪音稀釋。
  if (String(starId).toLowerCase() !== "lbj") return false;
  return safeTrack(
    () =>
      FacebookAnalytics.logEvent({
        event: "SubmitVote",
        params: {
          star_id: "lbj",
          stance: stance ?? "",
          warzone_id: warzoneId ?? "",
          reason_count: Number.isFinite(reasonCount) ? reasonCount : 0,
        },
      }),
    "SubmitVote"
  );
}
