/**
 * notifications/fcmTriggers.js — FCM 推播觸發器（Firestore 事件驅動）
 *
 * 設計意圖：
 * - 使用 Firebase Functions v1 Firestore 觸發器（functions.firestore.document().onUpdate/onCreate），
 *   而非 v2，原因：v2 Firestore 觸發器在本專案的部署區（us-central1）尚未全面穩定，
 *   保留 v1 可確保觸發可靠性直至 v2 Firestore trigger 正式 GA。
 * - 各觸發器均包含「冪等防護」：pushSent 旗標 + is_active 狀態雙重門禁，
 *   確保即便觸發器重試或 is_active 來回切換，推播也不會重複發送。
 * - sendBreakingPublishedTopicPush 抽離為共用函式，讓 onCreate / onUpdate 共享推播邏輯，
 *   FCM 成功寫入 pushSent 前不 rethrow，避免觸發器因 Firestore update 失敗而無限重試重複推播。
 */
import * as functions from "firebase-functions";
import { admin, FieldValue } from "../shared/admin.js";
import { FCM_TOPIC_WARZONE, GLOBAL_EVENTS_COLLECTION } from "../shared/constants.js";
import { resolveBreakingEventLocalizedText } from "../utils/resolveBreakingEventLocalizedText.js";

const BREAKING_PUSH_TITLE_FALLBACK = "🚨 突發戰區：新話題上線！";
const BREAKING_PUSH_BODY_FALLBACK = "歷史定位由你決定，立即參與即時投票。";

/**
 * 發送突發戰區「已發佈」推播，並寫入 pushSent 防止重複推播。
 *
 * FCM 與 pushSent 寫入分開 try：FCM 成功但 Firestore update 失敗時，
 * 不 rethrow（否則觸發器重試會再次推播）；失敗僅記錄，必要時依 log 手動補寫。
 */
async function sendBreakingPublishedTopicPush(eventRef, eventId, eventData, logLabel) {
  if (eventData.pushSent === true) return;

  const title = resolveBreakingEventLocalizedText(eventData.title, BREAKING_PUSH_TITLE_FALLBACK);
  const body = resolveBreakingEventLocalizedText(eventData.description, BREAKING_PUSH_BODY_FALLBACK);

  const message = {
    topic: FCM_TOPIC_WARZONE,
    notification: { title, body },
    data: { type: "BREAKING_VOTE", eventId: String(eventId) },
    // 不設定 notification.clickAction：若 action 在 AndroidManifest 無對應 intent-filter，
    // 點通知時系統無法啟動 App；省略後由系統以預設方式開啟 launcher Activity。
    android: {
      priority: "high",
      notification: { channelId: "breaking_warzone_channel" },
    },
    apns: {
      payload: { aps: { category: "BREAKING_VOTE", sound: "default" } },
    },
  };

  try {
    await admin.messaging().send(message);
  } catch (error) {
    functions.logger.error(`[${logLabel}] FCM send failed`, { eventId, message: error?.message });
    return;
  }

  try {
    await eventRef.update({ pushSent: true, updatedAt: FieldValue.serverTimestamp() });
    functions.logger.info(`[${logLabel}] push success`, { eventId });
  } catch (error) {
    functions.logger.error(`[${logLabel}] pushSent persist failed (FCM already sent)`, {
      eventId,
      message: error?.message,
    });
  }
}

/**
 * 當 profiles/{userId}.fcmTokens 變更時，將新 token 訂閱至 global_warzone topic。
 * 設計意圖：僅在 fcmTokens 陣列實際變更時呼叫 FCM API，避免每次 profile 任意欄位更新都重複訂閱。
 */
export const onProfileFCMTokensUpdate = functions.firestore
  .document("profiles/{userId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const prevTokens = Array.isArray(before.fcmTokens) ? before.fcmTokens : [];
    const nextTokens = Array.isArray(after.fcmTokens) ? after.fcmTokens : [];
    const changed =
      prevTokens.length !== nextTokens.length || nextTokens.some((t, i) => prevTokens[i] !== t);
    if (!changed || nextTokens.length === 0) return;

    try {
      const res = await admin.messaging().subscribeToTopic(nextTokens, FCM_TOPIC_WARZONE);
      if (process.env.GCLOUD_PROJECT?.includes("dev") || process.env.NODE_ENV === "development") {
        console.log("[onProfileFCMTokensUpdate] subscribeToTopic", res?.successCount, res?.failureCount);
      }
    } catch (err) {
      console.warn("[onProfileFCMTokensUpdate]", err?.message);
    }
  });

/**
 * 監聽 warzoneStats/global_summary 變更，於「領先者易主」時推播戰況反轉通知。
 *
 * 設計意圖：「平手（pro === anti）不視為領先者」確保不誤報；
 * 僅在 prevLeader 與 currLeader 均非 null 且不同時才推播，避免初始建立文件時觸發。
 */
export const onWarzoneLeaderChange = functions.firestore
  .document("warzoneStats/global_summary")
  .onUpdate(async (change) => {
    const prev = change.before.data() || {};
    const curr = change.after.data() || {};

    const getLeader = (data) => {
      const pro = (data.goat || 0) + (data.king || 0) + (data.machine || 0);
      const anti = (data.fraud || 0) + (data.stat_padder || 0) + (data.mercenary || 0);
      if (pro === anti) return null;
      return pro > anti ? "認同" : "反對";
    };

    const prevLeader = getLeader(prev);
    const currLeader = getLeader(curr);

    if (prevLeader != null && currLeader != null && prevLeader !== currLeader) {
      try {
        await admin.messaging().send({
          topic: FCM_TOPIC_WARZONE,
          notification: {
            title: "🚨 戰況反轉！歷史定位重新洗牌",
            body: `LBJ 的評價已被「${currLeader}派」佔領！目前戰況陷入拉鋸，快回來查看最新數據！`,
          },
        });
      } catch (err) {
        // 不 rethrow：避免觸發器因 FCM 暫時失敗而重試；文件已更新，推播可於下次易主時再送
        console.error("[onWarzoneLeaderChange] FCM send failed:", err?.message);
      }
    }
  });

/**
 * 突發戰區新議題建立時推播：僅推 is_active === true 且非草稿的事件，避免洗版。
 */
export const onNewBreakingEvent = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onCreate(async (snapshot, context) => {
    const eventData = snapshot.data();
    if (!eventData) return;
    if (eventData.status === "draft") return;
    if (eventData.is_active !== true) return;
    if (eventData.pushSent === true) return;
    await sendBreakingPublishedTopicPush(snapshot.ref, context.params.eventId, eventData, "onNewBreakingEvent");
  });

/**
 * 突發戰區草稿發佈通知：僅在 is_active 從非啟用 → true 轉換時發送推播。
 * 寫入 pushSent 後會再觸發 onUpdate，但因不滿足 false→true 條件，不會迴圈推播。
 */
export const onBreakingEventUpdate = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (!(before.is_active !== true && after.is_active === true)) return;
    if (after.pushSent === true || after.status === "draft") return;
    await sendBreakingPublishedTopicPush(change.after.ref, context.params.eventId, after, "onBreakingEventUpdate");
  });
