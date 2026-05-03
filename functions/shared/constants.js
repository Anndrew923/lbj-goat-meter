/**
 * shared/constants.js — 跨功能模組共用常數
 *
 * 設計意圖：
 * - 將所有「由環境決定的配置值」集中於此，讓每個 Feature 模組只需 import，不再各自讀取 process.env。
 * - STAR_ID 透過環境變數注入，是未來遷移至「社會風向計」等其他專案的唯一接縫點。
 * - RATE_LIMIT_CONFIG 以 Object.freeze 凍結，防止 Feature 模組意外改動造成跨請求污染。
 * - CALLABLE_HTTP_OPTS 在此定義後由各 Callable 合併使用，確保 concurrency / minInstances 策略一致。
 */

/** 球星識別碼：從環境變數注入，遷移至其他專案時替換此處即可，不需全域 grep。 */
export const STAR_ID = (process.env.STAR_ID || process.env.GOAT_STAR_ID || "lbj").trim() || "lbj";

/** Firestore 全域聚合文件 ID（warzoneStats/global_summary） */
export const GLOBAL_SUMMARY_DOC_ID = "global_summary";

/** Firestore 突發戰區集合名稱；跨 Feature 共用，以常數取代硬編碼字串避免拼寫錯誤 */
export const GLOBAL_EVENTS_COLLECTION = "global_events";

/** FCM topic：已登入且完成 profile 的使用者訂閱，用於戰況易主與突發戰區推播 */
export const FCM_TOPIC_WARZONE = "global_warzone";

/**
 * 安全旁路旗標：僅允許來自 localhost 的請求在開發模式下略過 reCAPTCHA／廣告驗證。
 * 正式環境此旗標應為空（預設），任何非 localhost origin 的請求一律執行完整驗證。
 */
export const HARD_SECURITY_BYPASS_FLAG = String(
  process.env.ALLOW_SECURITY_BYPASS_LOCALHOST || ""
).trim().toLowerCase();

/** reCAPTCHA 本機開發旁路佔位符號：前端在 localhost 無法取得有效 token 時使用，後端比對此字串後略過驗證。 */
export const LOCAL_RECAPTCHA_DEV_PLACEHOLDER = "dev-bypass-localhost-recaptcha";

/** reCAPTCHA 最低通過分數（0.7）：低於此值視為機器人，拒絕請求。 */
export const RECAPTCHA_MIN_SCORE = 0.7;

/** reCAPTCHA 灰色地帶下限（0.5）：低於此值直接拒絕；介於 0.5~0.7 進入二次驗證流程。 */
export const RECAPTCHA_GREY_ZONE_MIN = 0.5;

/** 限流統計視窗（ms）：60 秒內超過限額即觸發 rate-limit-exceeded。 */
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** 限流文件在 Firestore 的 TTL（ms）：過期文件由 Firestore TTL 策略自動清除，降低讀取成本。 */
export const RATE_LIMIT_TTL_MS = 5 * 60 * 1000;

/** 限流文件所在集合 */
export const RATE_LIMIT_COLLECTION = "rate_limits";

/**
 * 各 Action 的多維度限流配額（uid / ip / fingerprint）。
 * 設計意圖：breaking vote 允許較高頻（一人可快速投多個話題），submit_vote 更嚴格（一人一票核心）。
 */
export const RATE_LIMIT_CONFIG = Object.freeze({
  submit_vote: { uid: 6, ip: 20, fingerprint: 12 },
  submit_breaking_vote: { uid: 10, ip: 30, fingerprint: 20 },
});

/**
 * Gen2 Callable 共用 HTTP 選項。
 * 設計意圖：concurrency 80 讓單實例並發處理請求，降低冷啟動頻率；
 * minInstances 明確為 0 與 setGlobalOptions 一致，避免「保溫」費用。
 */
export const CALLABLE_HTTP_OPTS = { concurrency: 80, minInstances: 0 };
