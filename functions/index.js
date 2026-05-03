/**
 * GOAT Meter: LeBron — Cloud Functions 統一入口（純 re-export）
 *
 * 設計意圖：
 * - 此檔案僅作為 Firebase CLI 的掃描入口，不含任何業務邏輯。
 * - 依循「Feature 模組化」原則（對標 Spotify/Strava 後端目錄規範）：
 *   voting / account / analytics / battlecard / notifications 各自獨立，
 *   可單獨部署、單獨調整 memory / concurrency，互不干擾。
 * - setGlobalOptions 設定全域預設值；battlecard/generateBattleCard 因 Puppeteer 需求，
 *   在其子模組內覆寫 memory: "2GiB" / cpu: 2 / concurrency: 1，不受全域影響。
 * - 新增功能請在對應子目錄建立模組，並在此 re-export；不要在此檔案撰寫實作。
 *
 * 目錄結構：
 *   shared/          — admin 初始化、常數、Secret 宣告、安全中介層
 *   voting/          — submitVote, submitBreakingVote, resetPosition
 *   account/         — deleteUserAccount, issueAdRewardToken
 *   analytics/       — getFilteredSentimentSummary
 *   battlecard/      — generateBattleCard (2GiB/cpu2), getRenderStudioPayload
 *   notifications/   — FCM Firestore 觸發器（v1 API）
 *   utils/           — 純函數工具（verifyRecaptcha, voteAggregation, ...）
 */

import { setGlobalOptions } from "firebase-functions/v2/options";

/**
 * 全域預設配置：各子模組的 Callable 若無特殊需求，繼承此配置。
 * generateBattleCard 在子模組內以 memory/cpu/concurrency 覆寫，不受此限制。
 */
setGlobalOptions({
  region: process.env.FUNCTIONS_REGION || "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
  minInstances: 0,
});

// ── 投票核心 ────────────────────────────────────────────────────────────────
export { submitVote } from "./voting/submitVote.js";
export { submitBreakingVote } from "./voting/submitBreakingVote.js";
export { resetPosition } from "./voting/resetPosition.js";

// ── 帳號管理 ────────────────────────────────────────────────────────────────
export { deleteUserAccount } from "./account/deleteUserAccount.js";
export { issueAdRewardToken } from "./account/issueAdRewardToken.js";

// ── 數據分析 ────────────────────────────────────────────────────────────────
export { getFilteredSentimentSummary } from "./analytics/getFilteredSentimentSummary.js";

// ── 戰報卡渲染（高資源，獨立 memory/cpu/concurrency 配置） ──────────────────
export { generateBattleCard } from "./battlecard/generateBattleCard.js";
export { getRenderStudioPayload } from "./battlecard/getRenderStudioPayload.js";

// ── 推播通知（Firestore 事件驅動，使用 Firebase Functions v1 API） ─────────
export {
  onProfileFCMTokensUpdate,
  onWarzoneLeaderChange,
  onNewBreakingEvent,
  onBreakingEventUpdate,
} from "./notifications/fcmTriggers.js";
