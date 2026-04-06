/**
 * GOAT Meter: LeBron — Cloud Functions 後端寫入入口
 *
 * 設計意圖：
 * - 棄用 client-side App Check 寫入，所有對 votes / device_locks / warzoneStats 的修改一律透過 Admin SDK Transaction。
 * - 在最外層統一處理 reCAPTCHA 與廣告獎勵驗證，將 Firestore Security Rules 收緊為 read-only。
 * - Callable 已遷移至 Cloud Functions v2（記憶體 / 逾時 / minInstances 由 setGlobalOptions 統一設定）。
 */

import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import admin from "firebase-admin";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { verifyRecaptcha } from "./utils/verifyRecaptcha.js";
import { verifyAdRewardToken } from "./utils/verifyAdRewardToken.js";
import { signAdRewardToken } from "./utils/adRewardSigning.js";
import { computeGlobalDeductions } from "./utils/voteAggregation.js";
import { verifyGoldenKey } from "./utils/verifyGoldenKey.js";
import { normalizeBreakingOptionIndex } from "./utils/normalizeBreakingOptionIndex.js";
import { resolveBreakingEventLocalizedText } from "./utils/resolveBreakingEventLocalizedText.js";
import { hashDeviceFingerprintMaterial } from "./utils/fingerprintHash.js";
import { computeSentimentSummaryFromRows } from "./utils/computeSentimentSummary.js";
import { SSR_BATTLE_CARD_STANCE_PRIMARY } from "./battleCardConstants.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: process.env.FUNCTIONS_REGION || "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
  minInstances: 1,
});

/** Gen2 Callable 並發：單一實例可同時處理多個請求，降低尖峰排隊（上限依配額與記憶體調整） */
const CALLABLE_HTTP_OPTS = { concurrency: 80 };

/** 與 Secret Manager 鍵名一致；submitVote 綁定後執行期由 Firebase 掛載至 secret.value() */
const goatFingerprintPepperSecret = defineSecret("GOAT_FINGERPRINT_PEPPER");
/** 與 Secret Manager 鍵名一致；供 Golden Key HMAC 驗證使用，取代已棄用的 functions.config()。 */
const goatGoldenKeySecret = defineSecret("GOAT_GOLDEN_KEY_SECRET");
/** 與 Secret Manager 鍵名一致；issueAdRewardToken / resetPosition 自簽廣告獎勵 Token 用 */
const adRewardSigningSecret = defineSecret("AD_REWARD_SIGNING_SECRET");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const STAR_ID = (process.env.STAR_ID || process.env.GOAT_STAR_ID || "lbj").trim() || "lbj";
const GLOBAL_SUMMARY_DOC_ID = "global_summary";

/**
 * 是否允許略過嚴格安全驗證（僅限本地開發）。
 * 正式環境：僅允許來自 localhost 的請求略過；來自 Netlify 等正式網域的請求一律執行 reCAPTCHA／廣告驗證，驗證失敗即拋出 low-score-robot。
 */
function shouldBypassHardSecurity(context) {
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) || origin === "";
  return isLocalOrigin;
}

function requireAuth(context) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Authentication required", {
      code: "auth-required",
    });
  }
}

function parseTheme(theme) {
  const fallback = {
    primaryColor: "#C8102E",
    secondaryColor: "#2E003E",
    accentColor: "#FFD700",
    backgroundGradient: { start: "#A50022", end: "#120018" },
  };
  if (!theme || typeof theme !== "object") return fallback;
  const safeHex = (value, fb) => (/^#[0-9a-fA-F]{6}$/.test(String(value || "").trim()) ? String(value).trim() : fb);
  const bg = theme.backgroundGradient && typeof theme.backgroundGradient === "object" ? theme.backgroundGradient : {};
  return {
    primaryColor: safeHex(theme.primaryColor, fallback.primaryColor),
    secondaryColor: safeHex(theme.secondaryColor, fallback.secondaryColor),
    accentColor: safeHex(theme.accentColor, fallback.accentColor),
    backgroundGradient: {
      start: safeHex(bg.start, fallback.backgroundGradient.start),
      end: safeHex(bg.end, fallback.backgroundGradient.end),
    },
  };
}

/** 與前端戰報匯出一致：優先 theme 物件，否則從 teamColors 組出 parseTheme 輸入。 */
function parseThemeFromProfile(userData) {
  if (userData?.theme && typeof userData.theme === "object") {
    return parseTheme(userData.theme);
  }
  const tc = userData?.teamColors;
  if (tc && typeof tc === "object") {
    return parseTheme({
      primaryColor: tc.primary,
      secondaryColor: tc.secondary,
      accentColor: "#FFD700",
      backgroundGradient: { start: tc.primary, end: tc.secondary },
    });
  }
  return parseTheme(null);
}

/** 方案 B：客戶端傳入與 BattleCard 一致的顯示字串／色票；長度上限避免濫用與超大 payload。 */
const SSR_BATTLE_CARD_MAX_TEXT = 480;
const SSR_BATTLE_CARD_MAX_REASON_ITEM = 280;
const SSR_BATTLE_CARD_MAX_REASONS = 14;
/** 與 Auth／預覽顯示名一致；profiles 未必有 displayName，故允許客戶端覆寫。 */
const SSR_BATTLE_CARD_MAX_DISPLAY_NAME = 120;
const SSR_BATTLE_CARD_MAX_PHOTO_URL = 2048;

function clampSsrText(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.length <= max ? t : t.slice(0, max);
}

function normalizeSsrHexColor(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

/** 客戶 teamColors → parseTheme 輸入（與 TEAM_COLORS 結構對齊） */
function themeFromClientTeamColors(tc) {
  if (!tc || typeof tc !== "object") return null;
  const primary = normalizeSsrHexColor(tc.primary);
  const secondary = normalizeSsrHexColor(tc.secondary);
  if (!primary || !secondary) return null;
  return parseTheme({
    primaryColor: primary,
    secondaryColor: secondary,
    accentColor: "#FFD700",
    backgroundGradient: { start: primary, end: secondary },
  });
}

function normalizeClientReasonLabels(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr.slice(0, SSR_BATTLE_CARD_MAX_REASONS)) {
    const s = clampSsrText(String(item), SSR_BATTLE_CARD_MAX_REASON_ITEM);
    if (s) out.push(s);
  }
  return out;
}

/**
 * 身分／投票事實以 profiles 為準；顯示文案與色票可由客戶端覆寫（須 uid、voterTeam 一致）。
 * displayName／photoURL：與 BattleCard 預覽一致（來自 Auth）；profiles 常未存 displayName，故優先採客戶端 clamp 後字串。
 * @param {string} authUid
 * @param {Record<string, unknown>} userData
 * @param {Record<string, unknown>} clientData - request.data
 */
function mergeBattleCardSsrPayload(authUid, userData, clientData) {
  const d = clientData && typeof clientData === "object" ? clientData : {};

  const uidIn = typeof d.uid === "string" ? d.uid.trim() : "";
  if (uidIn && uidIn !== authUid) {
    throw new HttpsError("invalid-argument", "uid mismatch");
  }

  const clientDisplayName = clampSsrText(
    typeof d.displayName === "string" ? d.displayName : "",
    SSR_BATTLE_CARD_MAX_DISPLAY_NAME,
  );
  const profileDisplayName =
    typeof userData.displayName === "string" && userData.displayName.trim()
      ? userData.displayName.trim()
      : "";
  const displayName = clientDisplayName || profileDisplayName || "Warrior";

  const profileAvatarUrl =
    (typeof userData.avatarUrl === "string" && userData.avatarUrl.trim()) ||
    (typeof userData.photoURL === "string" && userData.photoURL.trim()) ||
    "";
  const clientPhotoURL = clampSsrText(
    typeof d.photoURL === "string" ? d.photoURL : "",
    SSR_BATTLE_CARD_MAX_PHOTO_URL,
  );
  const avatarUrl = clientPhotoURL || profileAvatarUrl;
  const stanceRaw = String(userData.currentStance || "GOAT").trim() || "GOAT";
  const stanceKey = stanceRaw.toLowerCase();

  const warzoneCode =
    String(userData.warzoneId || userData.voterTeam || "LAL")
      .trim()
      .toUpperCase() || "LAL";

  const clientVoter = typeof d.voterTeam === "string" ? d.voterTeam.trim().toUpperCase() : "";
  if (clientVoter && clientVoter !== warzoneCode) {
    throw new HttpsError("invalid-argument", "voterTeam mismatch");
  }

  const battleTitle =
    clampSsrText(typeof d.battleTitle === "string" ? d.battleTitle : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "戰區權威裁決";
  const battleSubtitle =
    clampSsrText(typeof d.battleSubtitle === "string" ? d.battleSubtitle : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "VERIFIED HISTORICAL DATA";
  const rankLabel =
    clampSsrText(typeof d.rankLabel === "string" ? d.rankLabel : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "Verified Global Data";

  const clientTeamLabel = clampSsrText(typeof d.teamLabel === "string" ? d.teamLabel : "", SSR_BATTLE_CARD_MAX_TEXT);
  const teamLabel = clientTeamLabel || warzoneCode;

  const reasonLabels = Array.isArray(d.reasonLabels)
    ? normalizeClientReasonLabels(d.reasonLabels)
    : Array.isArray(userData.currentReasons)
      ? userData.currentReasons.map((r) => String(r)).filter(Boolean).slice(0, SSR_BATTLE_CARD_MAX_REASONS)
      : [];

  const theme = themeFromClientTeamColors(d.teamColors) || parseThemeFromProfile(userData);

  const regionText =
    clampSsrText(typeof d.regionText === "string" ? d.regionText : "", SSR_BATTLE_CARD_MAX_TEXT) || "GLOBAL";
  const verdictSectionLabel =
    clampSsrText(typeof d.verdictSectionLabel === "string" ? d.verdictSectionLabel : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "VERDICT / 證詞";
  const metaFooterLine =
    clampSsrText(typeof d.metaFooterLine === "string" ? d.metaFooterLine : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "VERIFIED DATA · GOAT METER";
  const disclaimerLine =
    clampSsrText(typeof d.disclaimerLine === "string" ? d.disclaimerLine : "", SSR_BATTLE_CARD_MAX_TEXT) ||
    "Fan sentiment stats. Not affiliated with any player or league.";

  return {
    uid: authUid,
    displayName,
    avatarUrl,
    status: stanceKey,
    stanceDisplayPrimary: SSR_BATTLE_CARD_STANCE_PRIMARY[stanceKey] || stanceRaw.toUpperCase(),
    teamLabel,
    voterTeam: warzoneCode,
    reasonLabels,
    battleTitle,
    battleSubtitle,
    rankLabel,
    theme,
    regionText,
    verdictSectionLabel,
    metaFooterLine,
    disclaimerLine,
  };
}

/** 策略長「品質第一」：冷啟 + Chromium + 字型／頭像／networkidle0 須充裕余量。 */
const GENERATE_BATTLE_CARD_TIMEOUT_SEC = 180;
/** setContent：networkidle0 等網路靜默，上限 60s（須遠小於函式 180s）。 */
const BATTLE_CARD_SET_CONTENT_TIMEOUT_MS = 60_000;
/** 字型／頭像／雙 rAF 後 #render-ready-signal；與 networkidle0 互補。 */
const BATTLE_CARD_READY_SIGNAL_MS = 90_000;

/**
 * 戰報卡 SSR：身分／立場以 profiles 為準；標題／副標／rankLabel／teamLabel／證詞／teamColors 可由客戶端覆寫（方案 B），與 BattleCard 畫面一致。
 * 僅回傳 JPEG Base64；逾時 180s 優先求穩。
 */
export const generateBattleCard = onCall(
  {
    memory: "2GiB",
    timeoutSeconds: GENERATE_BATTLE_CARD_TIMEOUT_SEC,
    cpu: 2,
    minInstances: 0,
    concurrency: 1,
    enforceAppCheck: false,
  },
  async (request) => {
    requireAuth(request);
    if (request.data?.prewarm) {
      return { ok: true, status: "warmed" };
    }

    const authUid = request.auth.uid;
    const userDoc = await db.doc(`profiles/${authUid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "Profile missing");
    }
    const userData = userDoc.data() || {};
    const payload = mergeBattleCardSsrPayload(authUid, userData, request.data || {});

    let browser = null;
    try {
      /**
       * @sparticuz/chromium 僅支援 chrome-headless-shell；須 headless: "shell" + defaultArgs 合併。
       * 先前 `chromium.headless` 實際為 undefined → Puppeteer 套用 --headless=new，與 binary／args 衝突 → Target closed。
       */
      chromium.setGraphicsMode = false;

      browser = await puppeteer.launch({
        args: puppeteer.defaultArgs({
          args: chromium.args,
          headless: "shell",
        }),
        defaultViewport: null,
        executablePath: await chromium.executablePath(),
        headless: "shell",
        protocolTimeout: 180_000,
      });

      const page = await browser.newPage();
      /** DPR=2 易在雲端 OOM；1080 + quality 95 仍足夠精緻 */
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = req.url();
        if (
          /google-analytics\.com|googletagmanager\.com|\/gtag\/|doubleclick\.net|facebook\.net|connect\.facebook|hotjar\.com|clarity\.ms/i.test(
            u
          )
        ) {
          void req.abort();
          return;
        }
        void req.continue();
      });

      const { buildBattleCardVisualHtml } = await import("./battleCardVisualHtml.js");
      if (typeof buildBattleCardVisualHtml !== "function") {
        throw new Error("Visual Engine Missing");
      }
      const fullHtml = buildBattleCardVisualHtml(payload);

      await page.setContent(fullHtml, {
        waitUntil: "networkidle0",
        timeout: BATTLE_CARD_SET_CONTENT_TIMEOUT_MS,
      });

      await page.waitForSelector("#render-ready-signal", { timeout: BATTLE_CARD_READY_SIGNAL_MS }).catch(() => {
        console.warn("[generateBattleCard] render-ready-signal timeout, forcing capture.");
      });

      const imageBuffer = await page.screenshot({
        type: "jpeg",
        quality: 95,
        fullPage: false,
      });
      const base64Image = imageBuffer.toString("base64");

      return {
        ok: true,
        downloadBase64: base64Image,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err && typeof err.message === "string" ? err.message : "unknown";
      console.error("[generateBattleCard] 渲染失敗:", err);
      throw new HttpsError("internal", `後端渲染崩潰：${msg}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
);

/**
 * Render Studio 專用：以 Admin 讀取一次性 token 文件並回傳 payload。
 *
 * 設計意圖：Puppeteer 開啟的無頭頁面無法可靠取得 App Check token，導致客戶端 Firestore
 * 讀取在「強制 App Check」下會失敗時，舊版無頭頁曾無法設好 `__RENDER_READY__`。
 * generateBattleCard 已改為 Puppeteer setContent 全量視覺 HTML（與 BattleCard 對齊），一般不需此端點；仍保留供手動除錯或舊連結以 OTT 讀取 payload。
 * 此端點走 Admin SDK，不依賴瀏覽器 App Check；以 jobId + token 驗證並檢查過期時間。
 */
export const getRenderStudioPayload = onRequest(
  {
    region: process.env.FUNCTIONS_REGION || "us-central1",
    cors: true,
    memory: "256MiB",
    timeoutSeconds: 15,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const jobId = String(req.query.jobId || "").trim();
    const token = String(req.query.token || "").trim();
    if (!jobId || !token) {
      res.status(400).json({ error: "missing_params" });
      return;
    }
    try {
      const snap = await db.doc(`render_jobs/${jobId}/tokens/${token}`).get();
      if (!snap.exists) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const data = snap.data() || {};
      if (data.jobId !== jobId || data.renderToken !== token) {
        res.status(403).json({ error: "token_mismatch" });
        return;
      }
      const exp = data.expiresAt;
      if (exp && typeof exp.toMillis === "function" && exp.toMillis() < Date.now()) {
        res.status(410).json({ error: "expired" });
        return;
      }
      res.set("Cache-Control", "no-store");
      res.status(200).json({ payload: data.payload ?? null });
    } catch (err) {
      console.error("[getRenderStudioPayload]", err?.message || err);
      res.status(500).json({ error: "internal" });
    }
  }
);

/**
 * 解析指紋用 pepper：優先 Gen2 secret.value()，失敗則 GOAT_FINGERPRINT_PEPPER（Emulator／本機）。
 * Cloud Run 上若兩者皆空會略過 24h 查重，故在 K_SERVICE 存在時寫 warn 便於營運發現未掛 Secret。
 */
function resolveFingerprintPepper(secret) {
  try {
    const v = secret.value();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Emulator 或未解析 secret 時改走環境變數
  }
  const fromEnv = process.env.GOAT_FINGERPRINT_PEPPER?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.K_SERVICE) {
    functions.logger.warn(
      "[submitVote] GOAT_FINGERPRINT_PEPPER 未解析：24h 裝置查重已停用，請確認 Secret 已綁定並部署"
    );
  }
  return "";
}

/**
 * 解析 Golden Key：優先讀取 Gen2 Secret Manager，失敗時回退環境變數（Emulator / 本機）。
 * 設計意圖：移除對 functions.config() 的依賴，避免 v2 服務在 Runtime Config 停用時失效。
 */
function resolveGoldenKeySecret(secret) {
  try {
    const v = secret.value();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Emulator 或未解析 secret 時改走環境變數
  }
  const fromEnv = (process.env.GOLDEN_KEY_SECRET || process.env.GOAT_GOLDEN_KEY_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  if (process.env.K_SERVICE) {
    functions.logger.warn("[GoldenKey] GOAT_GOLDEN_KEY_SECRET 未解析，簽章驗證將失敗。請確認 Secret 已綁定並部署。");
  }
  return "";
}

/**
 * 解析廣告獎勵簽章金鑰：優先 Gen2 secret.value()，失敗則 AD_REWARD_SIGNING_SECRET（Emulator／舊版純環境變數部署）。
 */
function resolveAdRewardSigningSecret(secret) {
  try {
    const v = secret.value();
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  } catch {
    // Emulator 或未解析 secret 時改走環境變數
  }
  const fromEnv = process.env.AD_REWARD_SIGNING_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.K_SERVICE) {
    functions.logger.warn(
      "[adReward] AD_REWARD_SIGNING_SECRET 未解析：原生 App 看完廣告後無法簽發 Token，請在 Secret Manager 建立並綁定至 issueAdRewardToken、resetPosition"
    );
  }
  return "";
}

/**
 * submitVote — 後端唯一入口：提交一票。
 *
 * 資料一致性與避免 Race Condition 的設計說明：
 * - 使用 Firestore Transaction：讀取 profile、device_locks、global_summary、選擇性指紋查重；寫入 vote、device_lock、warzoneStats（increment）、global_summary、profile。
 * - 先檢查 profiles.{uid}.hasVoted 與 device_locks.{deviceId}.active，避免同一帳號或同一設備重複投票。
 * - device_locks 採「一設備一票」策略：若鎖存在且 active=true，整個 Transaction 立即失敗。
 * - warzoneStats 與 global_summary 的加總全部落在同一個 Transaction 內完成，保證「統計 + 鎖定狀態」要嘛一起成功、要嘛一起回滾。
 */
export const submitVote = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatFingerprintPepperSecret, goatGoldenKeySecret] },
  async (request) => {
    requireAuth(request);

    const fingerprintPepper = resolveFingerprintPepper(goatFingerprintPepperSecret);
    const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);

    try {
      return await runSubmitVote(request.data, {
        auth: request.auth,
        rawRequest: request.rawRequest,
        fingerprintPepper,
        goldenKeySecret,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[submitVote] Unexpected error:", err?.message);
      throw new HttpsError("internal", "Vote failed", { code: "vote-internal" });
    }
  }
);

/**
 * @param {unknown} data - Callable payload
 * @param {{ auth: { uid: string }; rawRequest?: unknown; fingerprintPepper?: string; goldenKeySecret?: string }} context
 */
async function runSubmitVote(data, context) {
  const { voteData, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const uid = context.auth.uid;

  if (!voteData || typeof voteData !== "object") {
    throw new HttpsError("invalid-argument", "voteData is required");
  }
  const { selectedStance, selectedReasons, deviceId } = voteData;
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";

  if (!deviceIdStr) {
    throw new HttpsError("invalid-argument", "deviceId is required");
  }
  if (typeof selectedStance !== "string" || !selectedStance) {
    throw new HttpsError("invalid-argument", "selectedStance is required");
  }
  if (!Array.isArray(selectedReasons)) {
    throw new HttpsError("invalid-argument", "selectedReasons must be an array");
  }

  // Golden Key：驗證前端簽章，避免未經授權腳本濫發請求。
  verifyGoldenKey(
    "submit_vote",
    {
      uid,
      deviceId: deviceIdStr,
      selectedStance,
    },
    { xGoatTimestamp, xGoatSignature },
    { uid, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  // 投票才看分數：大量假投票會破壞數據可信度，故正式環境要求 reCAPTCHA 分數 ≥ 0.5
  if (shouldBypassHardSecurity(context)) {
    console.warn("[submitVote] Bypassing reCAPTCHA verification (localhost only).");
  } else {
    const recaptchaResult = await verifyRecaptcha(recaptchaToken, { minScore: 0.5 });
    if (!recaptchaResult.success) {
      throw new HttpsError("failed-precondition", "reCAPTCHA verification failed", {
        code: "recaptcha-verify-failed",
        recaptchaScore: recaptchaResult.score,
        recaptchaError: recaptchaResult.raw?.error ?? null,
        recaptchaAction: recaptchaResult.action ?? null,
      });
    }
  }

  // Observability：社會風向計後續人工審核用 metadata（userAgent / ip）
  const ip =
    context.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    context.rawRequest?.ip ||
    "";
  const userAgent = context.rawRequest?.headers?.["user-agent"] || "";
  console.log("[submitVote] metadata", { ip, userAgent, uid });

  const profileRef = db.doc(`profiles/${uid}`);
  const votesRef = db.collection("votes");
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const deviceLockRef = db.doc(`device_locks/${deviceIdStr}`);

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      throw new HttpsError("failed-precondition", "Profile not found");
    }
    const profile = profileSnap.data() || {};
    if (profile.hasVoted === true) {
      throw new HttpsError("failed-precondition", "Already voted");
    }

    const warzoneId = String(profile.warzoneId ?? profile.voterTeam ?? "").trim();
    if (!warzoneId) {
      throw new HttpsError("failed-precondition", "warzone required");
    }

    const deviceLockSnap = await tx.get(deviceLockRef);
    if (deviceLockSnap.exists) {
      const lockData = deviceLockSnap.data() || {};
      if (lockData.active === true) {
        throw new HttpsError("failed-precondition", "Device already voted", {
          code: "device-already-voted",
        });
      }
    }

    const fingerprintHash = hashDeviceFingerprintMaterial(deviceIdStr, context.fingerprintPepper);
    if (fingerprintHash) {
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
      const cutoff = Timestamp.fromMillis(cutoffMs);
      const dupQ = db
        .collection("votes")
        .where("warzoneId", "==", warzoneId)
        .where("fingerprintHash", "==", fingerprintHash)
        .where("createdAt", ">=", cutoff)
        .limit(8);
      const dupSnap = await tx.get(dupQ);
      for (const d of dupSnap.docs) {
        const otherUid = d.data()?.userId;
        if (otherUid && otherUid !== uid) {
          throw new HttpsError("permission-denied", "Device recently voted in this warzone", {
            code: "fingerprint-recent-vote",
          });
        }
      }
    }

    const globalSnap = await tx.get(globalSummaryRef);
    const globalData = (() => {
      if (!globalSnap.exists) {
        return {
          totalVotes: 0,
          recentVotes: [],
          reasonCountsLike: {},
          reasonCountsDislike: {},
          countryCounts: {},
          goat: 0,
          fraud: 0,
          king: 0,
          mercenary: 0,
          machine: 0,
          stat_padder: 0,
        };
      }
      const d = globalSnap.data() || {};
      return {
        totalVotes: typeof d.totalVotes === "number" ? d.totalVotes : 0,
        recentVotes: Array.isArray(d.recentVotes) ? d.recentVotes : [],
        reasonCountsLike: typeof d.reasonCountsLike === "object" && d.reasonCountsLike ? d.reasonCountsLike : {},
        reasonCountsDislike:
          typeof d.reasonCountsDislike === "object" && d.reasonCountsDislike ? d.reasonCountsDislike : {},
        countryCounts: typeof d.countryCounts === "object" && d.countryCounts ? d.countryCounts : {},
        goat: typeof d.goat === "number" ? d.goat : 0,
        fraud: typeof d.fraud === "number" ? d.fraud : 0,
        king: typeof d.king === "number" ? d.king : 0,
        mercenary: typeof d.mercenary === "number" ? d.mercenary : 0,
        machine: typeof d.machine === "number" ? d.machine : 0,
        stat_padder: typeof d.stat_padder === "number" ? d.stat_padder : 0,
      };
    })();

    const newVoteRef = votesRef.doc();
    tx.set(newVoteRef, {
      starId: STAR_ID,
      userId: uid,
      deviceId: deviceIdStr,
      ...(fingerprintHash ? { fingerprintHash } : {}),
      status: selectedStance,
      reasons: selectedReasons,
      warzoneId,
      voterTeam: warzoneId,
      ageGroup: profile.ageGroup ?? "",
      gender: profile.gender ?? "",
      country: profile.country ?? "",
      city: profile.city ?? "",
      hadWarzoneStats: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(deviceLockRef, {
      lastVoteId: newVoteRef.id,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const warzoneStatsRef = db.doc(`warzoneStats/${warzoneId}`);
    tx.set(
      warzoneStatsRef,
      {
        totalVotes: FieldValue.increment(1),
        [selectedStance]: FieldValue.increment(1),
      },
      { merge: true }
    );

    const newTotal = globalData.totalVotes + 1;
    const stanceKeys = ["goat", "fraud", "king", "mercenary", "machine", "stat_padder"];
    const stanceCounts = {};
    stanceKeys.forEach((key) => {
      stanceCounts[key] = globalData[key] + (key === selectedStance ? 1 : 0);
    });

    const newRecentEntry = {
      status: selectedStance,
      city: profile.city ?? "",
      country: profile.country ?? "",
      voterTeam: warzoneId,
      createdAt: Timestamp.now(),
    };
    const newRecentVotes = [newRecentEntry, ...(globalData.recentVotes || [])].slice(0, 10);

    const reasonCountsLike = { ...(globalData.reasonCountsLike || {}) };
    const reasonCountsDislike = { ...(globalData.reasonCountsDislike || {}) };
    (selectedReasons || []).forEach((r) => {
      if (["goat", "king", "machine"].includes(selectedStance)) {
        reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1;
      } else if (["fraud", "stat_padder", "mercenary"].includes(selectedStance)) {
        reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1;
      }
    });

    const countryCounts = { ...(globalData.countryCounts || {}) };
    const cc = String(profile.country ?? "").toUpperCase().slice(0, 2);
    if (cc) {
      const prev = countryCounts[cc] ?? { pro: 0, anti: 0 };
      countryCounts[cc] = {
        pro:
          (prev.pro ?? 0) +
          (["goat", "king", "machine"].includes(selectedStance) ? 1 : 0),
        anti:
          (prev.anti ?? 0) +
          (["fraud", "stat_padder", "mercenary"].includes(selectedStance) ? 1 : 0),
      };
    }

    tx.set(
      globalSummaryRef,
      {
        totalVotes: newTotal,
        ...stanceCounts,
        recentVotes: newRecentVotes,
        reasonCountsLike,
        reasonCountsDislike,
        countryCounts,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(profileRef, {
      hasVoted: true,
      currentStance: selectedStance,
      currentReasons: selectedReasons,
      currentVoteId: newVoteRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
}

/**
 * resetPosition — 看完廣告後重置立場。
 *
 * 資料一致性與避免 Race Condition 的設計說明：
 * - 同樣使用單一 Transaction，同步處理：
 *   - profile.hasVoted 與 currentVoteId 等欄位清除。
 *   - 對應 votes 文件刪除。
 *   - 對應 device_locks 解鎖（刪除）。
 *   - warzoneStats 與 global_summary 依現有投票資料做「減法」，確保統計與實際票數對齊。
 * - 所有操作要嘛一起成功，要嘛全部回滾，不會出現「設備已解鎖但統計未扣回」的中間狀態。
 */
export const resetPosition = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatGoldenKeySecret, adRewardSigningSecret] },
  async (request) => {
  requireAuth(request);

  const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);
  const adRewardSigningSecretResolved = resolveAdRewardSigningSecret(adRewardSigningSecret);

  try {
    return await runResetPosition(request.data, {
      auth: request.auth,
      rawRequest: request.rawRequest,
      goldenKeySecret,
      adRewardSigningSecret: adRewardSigningSecretResolved,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[resetPosition] Unexpected error:", err?.message);
    throw new HttpsError("internal", "Reset failed", { code: "reset-internal" });
  }
}
);

async function runResetPosition(data, context) {
  const { adRewardToken, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const uid = context.auth.uid;

  // 簽章 payload 必須與前端 createGoldenKeySignature(RESET_POSITION, …) 一致：僅 { adRewardToken }。
  verifyGoldenKey(
    "reset_position",
    { adRewardToken: adRewardToken || null },
    { xGoatTimestamp, xGoatSignature },
    { uid },
    context.goldenKeySecret || ""
  );

  const bypassSecurity = shouldBypassHardSecurity(context);
  const allowedWebOrigins = (process.env.ALLOWED_WEB_ORIGIN || "https://lbj-goat-meter.netlify.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (context.rawRequest?.headers?.origin || "").trim();
  const isWebNoAdSdk = adRewardToken === "web-no-ad-sdk";
  const isAllowedWebOrigin = allowedWebOrigins.includes(origin);
  const isWebNoAdSdkAllowed = isWebNoAdSdk && isAllowedWebOrigin;

  if (bypassSecurity) {
    console.warn("[resetPosition] Bypassing reCAPTCHA and ad reward verification (localhost only).");
  } else if (isWebNoAdSdkAllowed) {
    // 網頁版無廣告 SDK 過渡：origin 已驗證即放行
    console.log("[resetPosition] Web 無廣告 SDK 過渡：允許重置（origin 已驗證）");
  } else {
    // 重置立場不看 reCAPTCHA 分數：僅以廣告／origin 為門檻；即便被繞過也只是撤一票，不影響整體數據可信度
    const adResult = await verifyAdRewardToken(adRewardToken, context.adRewardSigningSecret);
    if (!adResult.success) {
      throw new HttpsError("failed-precondition", "Ad reward not verified", {
        code: "ad-not-watched",
      });
    }
    // 自簽 Token 必須為當前使用者簽發，防止 Token 被轉用
    const tokenUid = adResult.raw?.payload?.uid;
    if (typeof tokenUid === "string" && tokenUid !== uid) {
      throw new HttpsError("failed-precondition", "Ad reward token user mismatch", {
        code: "ad-not-watched",
      });
    }
  }

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);

  let deletedVoteId = null;

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      throw new HttpsError("failed-precondition", "Profile not found");
    }
    const profileData = profileSnap.data() || {};
    if (profileData.hasVoted !== true) {
      // 無票可扣，視為邏輯錯誤但不算嚴重，直接返回。
      return;
    }

    const raw = profileData.currentVoteId;
    const voteDocId = typeof raw === "string" && raw.length > 0 ? raw : null;
    let voteData = null;
    let globalSnap = null;

    if (voteDocId) {
      const voteRef = db.doc(`votes/${voteDocId}`);
      const voteSnap = await tx.get(voteRef);
      voteData = voteSnap.exists ? voteSnap.data() : null;
      globalSnap = await tx.get(globalSummaryRef);
    }

    /** 必須於任何 write 前先讀取 warzone（Firestore Transaction 規則） */
    let warzoneRead = null;
    if (voteDocId && voteData && voteData.hadWarzoneStats === true) {
      const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
      const st = typeof voteData.status === "string" ? voteData.status.trim() : "";
      if (wid && st) {
        const wzRef = db.doc(`warzoneStats/${wid}`);
        warzoneRead = { ref: wzRef, snap: await tx.get(wzRef), stance: st };
      }
    }

    const updatePayload = {
      hasVoted: false,
      currentStance: FieldValue.delete(),
      currentReasons: FieldValue.delete(),
      currentVoteId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.update(profileRef, updatePayload);

    if (voteDocId && voteData) {
      const voteDeviceId = typeof voteData.deviceId === "string" ? voteData.deviceId.trim() : "";
      if (voteDeviceId) {
        tx.delete(db.doc(`device_locks/${voteDeviceId}`));
      }
      tx.delete(db.doc(`votes/${voteDocId}`));
      deletedVoteId = voteDocId;

      const status = voteData.status;
      if (warzoneRead) {
        const w = warzoneRead.snap.exists ? warzoneRead.snap.data() || {} : {};
        const st = warzoneRead.stance;
        const curTotal = typeof w.totalVotes === "number" ? w.totalVotes : 0;
        const curStance = typeof w[st] === "number" ? w[st] : 0;
        tx.set(
          warzoneRead.ref,
          {
            totalVotes: Math.max(0, curTotal - 1),
            [st]: Math.max(0, curStance - 1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (globalSnap?.exists && status) {
        const globalData = globalSnap.data() || {};
        const deduction = computeGlobalDeductions(globalData, [{ id: voteDocId, data: voteData }]);
        tx.set(
          globalSummaryRef,
          {
            ...deduction,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  });

  return { ok: true, deletedVoteId };
}

/**
 * deleteUserAccount — 帳號刪除資料清理（後端全交易執行）。
 *
 * 設計意圖：
 * - 由 Admin SDK 在單一 Transaction 內完成扣票與刪除，避免前端權限不足造成 Permission Denied。
 * - 確保「統計遞減」與「文件刪除」同生共死，不會留下不一致的中間狀態。
 */
export const deleteUserAccount = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);
  const uid = request.auth.uid;

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const userVotesQuery = db
    .collection("votes")
    .where("userId", "==", uid)
    .where("starId", "==", STAR_ID)
    .limit(500);
  const profileBreakingVotesQuery = db.collection(`profiles/${uid}/breaking_votes`).limit(500);

  try {
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const globalSnap = await tx.get(globalSummaryRef);
      const userVotesSnap = await tx.get(userVotesQuery);
      const profileBreakingVotesSnap = await tx.get(profileBreakingVotesQuery);

      // 防禦性門檻：避免 limit 命中時只刪掉前 500 筆造成「部分成功」。
      // 若資料量超出可安全交易範圍，直接中止並回報，維持資料一致性優先。
      if (userVotesSnap.size >= 500) {
        throw new HttpsError(
          "failed-precondition",
          "Too many votes to delete safely in a single transaction",
          { code: "delete-account-too-many-votes", count: userVotesSnap.size }
        );
      }
      if (profileBreakingVotesSnap.size >= 500) {
        throw new HttpsError(
          "failed-precondition",
          "Too many breaking votes to delete safely in a single transaction",
          { code: "delete-account-too-many-breaking-votes", count: profileBreakingVotesSnap.size }
        );
      }

      const userVoteRows = userVotesSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

      const breakingRows = [];
      for (const proofDoc of profileBreakingVotesSnap.docs) {
        const proofData = proofDoc.data() || {};
        const eventId = proofDoc.id;
        const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}`);
        const eventSnap = await tx.get(eventRef);
        breakingRows.push({
          eventId,
          proofRef: proofDoc.ref,
          proofData,
          eventRef,
          eventSnap,
        });
      }

      // 扣回戰區票數（地方戰區）
      const warzoneDeltas = new Map();
      for (const row of userVoteRows) {
        const vote = row.data || {};
        if (vote.hadWarzoneStats !== true) continue;
        const status = typeof vote.status === "string" ? vote.status.trim() : "";
        const warzoneId = String(vote.warzoneId || vote.voterTeam || "").trim();
        if (!status || !warzoneId) continue;
        if (!warzoneDeltas.has(warzoneId)) {
          warzoneDeltas.set(warzoneId, { totalVotes: 0, stance: {} });
        }
        const bucket = warzoneDeltas.get(warzoneId);
        bucket.totalVotes -= 1;
        bucket.stance[status] = (bucket.stance[status] || 0) - 1;
      }
      const warzoneSnapById = new Map();
      for (const warzoneId of warzoneDeltas.keys()) {
        warzoneSnapById.set(warzoneId, await tx.get(db.doc(`warzoneStats/${warzoneId}`)));
      }
      for (const [warzoneId, delta] of warzoneDeltas.entries()) {
        const warzoneRef = db.doc(`warzoneStats/${warzoneId}`);
        const wzSnap = warzoneSnapById.get(warzoneId);
        const w = wzSnap?.exists ? wzSnap.data() || {} : {};
        const curTotal = typeof w.totalVotes === "number" ? w.totalVotes : 0;
        const newTotal = Math.max(0, curTotal + delta.totalVotes);
        const payload = {
          totalVotes: newTotal,
          updatedAt: FieldValue.serverTimestamp(),
        };
        Object.entries(delta.stance).forEach(([status, count]) => {
          const cur = typeof w[status] === "number" ? w[status] : 0;
          payload[status] = Math.max(0, cur + count);
        });
        tx.set(warzoneRef, payload, { merge: true });
      }

      // 扣回 global_summary（全域戰區）
      if (globalSnap.exists && userVoteRows.length > 0) {
        const globalData = globalSnap.data() || {};
        const deduction = computeGlobalDeductions(globalData, userVoteRows);
        tx.set(
          globalSummaryRef,
          {
            ...deduction,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 扣回突發戰區票數，並刪除 global_events/{eventId}/votes/{deviceId} + profile 存證
      for (const row of breakingRows) {
        const { eventId, proofData, eventRef, eventSnap, proofRef } = row;
        if (eventSnap.exists) {
          const eventData = eventSnap.data() || {};
          const options = Array.isArray(eventData.options) ? eventData.options : [];
          const optionsLen = options.length;
          const rawOptionIndex = Number(proofData.optionIndex);
          const clampedOptionIndex =
            optionsLen > 0 && Number.isFinite(rawOptionIndex)
              ? Math.max(0, Math.min(Math.floor(rawOptionIndex), optionsLen - 1))
              : 0;
          const voteCountPath = `vote_counts.${clampedOptionIndex}`;
          tx.update(eventRef, {
            total_votes: FieldValue.increment(-1),
            [voteCountPath]: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const deviceId = typeof proofData.deviceId === "string" ? proofData.deviceId.trim() : "";
        if (deviceId) {
          tx.delete(db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}/votes/${deviceId}`));
        }
        tx.delete(proofRef);
      }

      // 刪除主戰區 votes 與 device_locks
      for (const row of userVoteRows) {
        const vote = row.data || {};
        const deviceId = typeof vote.deviceId === "string" ? vote.deviceId.trim() : "";
        if (deviceId) {
          tx.delete(db.doc(`device_locks/${deviceId}`));
        }
        tx.delete(db.doc(`votes/${row.id}`));
      }

      if (profileSnap.exists) {
        tx.delete(profileRef);
      }
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[deleteUserAccount] Unexpected error:", err?.message);
    throw new HttpsError("internal", "Delete account failed", {
      code: "delete-account-internal",
    });
  }
});

const FCM_TOPIC_WARZONE = "global_warzone";

/**
 * onProfileFCMTokensUpdate — 當 profile 的 fcmTokens 變更時，將 token 訂閱至 global_warzone topic，以接收戰況即時快報。
 * 僅在 fcmTokens 陣列實際變更時呼叫 FCM API，避免每次 profile 更新都重複訂閱。
 */
export const onProfileFCMTokensUpdate = functions.firestore
  .document("profiles/{userId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const prevTokens = Array.isArray(before.fcmTokens) ? before.fcmTokens : [];
    const nextTokens = Array.isArray(after.fcmTokens) ? after.fcmTokens : [];
    const changed =
      prevTokens.length !== nextTokens.length ||
      nextTokens.some((t, i) => prevTokens[i] !== t);
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
 * onWarzoneLeaderChange — 戰況即時快報：僅在「領先者易主」時推播。
 *
 * 設計意圖：監聽 warzoneStats/global_summary 的 onUpdate，比較前後狀態的認同／反對加總，
 * 若領先方從認同變反對（或反之）則發送 FCM 至 topic "global_warzone"。
 * 平手（pro === anti）不視為領先者，不發送推播，避免誤報。
 * 訂閱由 onProfileFCMTokensUpdate 在寫入 fcmTokens 時自動完成。
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
      const payload = {
        topic: "global_warzone",
        notification: {
          title: "🚨 戰況反轉！歷史定位重新洗牌",
          body: `LBJ 的評價已被「${currLeader}派」佔領！目前戰況陷入拉鋸，快回來查看最新數據！`,
        },
      };
      try {
        return await admin.messaging().send(payload);
      } catch (err) {
        console.error("[onWarzoneLeaderChange] FCM send failed:", err?.message);
        // 不 rethrow，避免觸發器因 FCM 暫時失敗而重試；文件已更新，推播可於下次易主時再送
      }
    }
  });

const GLOBAL_EVENTS_COLLECTION = "global_events";

const BREAKING_PUSH_TITLE_FALLBACK = "🚨 突發戰區：新話題上線！";
const BREAKING_PUSH_BODY_FALLBACK = "歷史定位由你決定，立即參與即時投票。";

/**
 * 突發戰區「已發佈」推播：與 onCreate / 從草稿發佈（onUpdate）共用。
 * 成功發送後寫入 pushSent，避免同一議題重複推播（含觸發器重試與 is_active 來回切換）。
 *
 * FCM 與 Firestore update 分開 try：若推播已成功但 update 失敗，不可 rethrow 整段（否則觸發器重試會重複推播）；
 * 此時僅記錄，必要時依 log 手動補寫 pushSent。
 *
 * @param {FirebaseFirestore.DocumentReference} eventRef
 * @param {string} eventId
 * @param {Record<string, unknown>} eventData
 * @param {string} logLabel
 */
async function sendBreakingPublishedTopicPush(eventRef, eventId, eventData, logLabel) {
  if (eventData.pushSent === true) return;

  const title = resolveBreakingEventLocalizedText(eventData.title, BREAKING_PUSH_TITLE_FALLBACK);
  const body = resolveBreakingEventLocalizedText(eventData.description, BREAKING_PUSH_BODY_FALLBACK);

  const message = {
    topic: FCM_TOPIC_WARZONE,
    notification: {
      title,
      body,
    },
    data: {
      type: "BREAKING_VOTE",
      eventId: String(eventId),
    },
    // 勿設定 notification.clickAction：若 action 在 AndroidManifest 無對應 intent-filter，
    // 使用者點通知時系統可能無法啟動 App。省略後由系統以預設方式開啟 launcher Activity。
    android: {
      priority: "high",
      notification: {
        channelId: "breaking_warzone_channel",
      },
    },
    apns: {
      payload: {
        aps: {
          category: "BREAKING_VOTE",
          sound: "default",
        },
      },
    },
  };

  try {
    await admin.messaging().send(message);
  } catch (error) {
    functions.logger.error(`[${logLabel}] FCM send failed`, {
      eventId,
      message: error?.message,
    });
    return;
  }

  try {
    await eventRef.update({
      pushSent: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    functions.logger.info(`[${logLabel}] push success`, { eventId });
  } catch (error) {
    functions.logger.error(`[${logLabel}] pushSent persist failed (FCM already sent)`, {
      eventId,
      message: error?.message,
    });
  }
}

/**
 * onNewBreakingEvent — 突發戰區發佈通知：新議題建立時推播至 global_warzone topic（與 onWarzoneLeaderChange 主投票通知並存）。
 *
 * 設計意圖：data 帶 eventId（字串）供客戶端點擊後深連；略過草稿 status、is_active 非 true、或空文件，避免洗版。
 * FCM data payload 值須全為字串；notification title/body 必須為字串（後台欄位為本地化物件時需先解析）。
 */
export const onNewBreakingEvent = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onCreate(async (snapshot, context) => {
    const eventData = snapshot.data();
    if (!eventData) return;
    if (eventData.status === "draft") return;
    // 與 onBreakingEventUpdate 一致：僅在「已啟用」時推播（false／缺欄／非布林皆不推）
    if (eventData.is_active !== true) return;
    if (eventData.pushSent === true) return;

    const eventId = context.params.eventId;
    await sendBreakingPublishedTopicPush(snapshot.ref, eventId, eventData, "onNewBreakingEvent");
  });

/**
 * onBreakingEventUpdate — 草稿發佈通知：監聽 global_events/{eventId} onUpdate。
 *
 * 觸發：before 非啟用（false 或欄位缺失）且 after.is_active === true。
 * 門禁：after.pushSent === true 或 after.status === 'draft' 不送（與 onCreate 共用 sendBreakingPublishedTopicPush + pushSent）。
 * 寫入 pushSent 後會再觸發 onUpdate，但因不符合 false→true，不會迴圈推播。
 */
export const onBreakingEventUpdate = functions.firestore
  .document(`${GLOBAL_EVENTS_COLLECTION}/{eventId}`)
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    if (!(before.is_active !== true && after.is_active === true)) return;
    if (after.pushSent === true || after.status === "draft") return;

    const eventId = context.params.eventId;
    await sendBreakingPublishedTopicPush(change.after.ref, eventId, after, "onBreakingEventUpdate");
  });

/**
 * submitBreakingVote — 突發戰區投票：一話題一設備一票，寫入 global_events/{eventId}/votes/{deviceId}。
 */
export const submitBreakingVote = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [goatGoldenKeySecret] },
  async (request) => {
  requireAuth(request);

  const goldenKeySecret = resolveGoldenKeySecret(goatGoldenKeySecret);

  try {
    return await runSubmitBreakingVote(request.data, {
      auth: request.auth,
      rawRequest: request.rawRequest,
      goldenKeySecret,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[submitBreakingVote]", err?.message);
    throw new HttpsError("internal", "Breaking vote failed", {
      code: "breaking-vote-internal",
    });
  }
}
);

async function runSubmitBreakingVote(data, context) {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required", { code: "auth-required" });
  }

  const { eventId, optionIndex, deviceId, recaptchaToken, xGoatTimestamp, xGoatSignature } = data || {};
  const eventIdStr = typeof eventId === "string" ? eventId.trim() : "";
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!eventIdStr || !deviceIdStr) {
    throw new HttpsError("invalid-argument", "eventId and deviceId required");
  }
  const option = normalizeBreakingOptionIndex(optionIndex);

  // 簽章 payload 必須與前端 createGoldenKeySignature(SUBMIT_BREAKING_VOTE, …) 完全一致：
  // 僅 { eventId, deviceId, optionIndex }。若後端多帶 uid，JSON.stringify 不同會永遠 signature-mismatch。
  verifyGoldenKey(
    "submit_breaking_vote",
    {
      eventId: eventIdStr,
      deviceId: deviceIdStr,
      optionIndex: option,
    },
    { xGoatTimestamp, xGoatSignature },
    { uid: context.auth.uid || null, deviceId: deviceIdStr },
    context.goldenKeySecret || ""
  );

  if (!shouldBypassHardSecurity(context)) {
    let recaptchaResult;
    try {
      recaptchaResult = await verifyRecaptcha(recaptchaToken, { minScore: 0.5 });
    } catch (recaptchaErr) {
      functions.logger.error("[submitBreakingVote][recaptcha-config]", {
        message: recaptchaErr?.message,
        uid: context.auth?.uid,
      });
      throw new HttpsError(
        "failed-precondition",
        "reCAPTCHA verification unavailable",
        { code: "recaptcha-config-error" }
      );
    }
    if (!recaptchaResult.success) {
      // recaptchaResult.score 可能為 null（例如 invalid-input-secret / invalid-input-response）。
      // 用 structure 化資訊把根因丟給前端/Log，避免一律被誤判為 low-score-robot。
      throw new HttpsError("failed-precondition", "reCAPTCHA verification failed", {
        code: "recaptcha-verify-failed",
        recaptchaScore: recaptchaResult.score,
        recaptchaError: recaptchaResult.raw?.error ?? null,
        // Google 回傳 invalid-input-secret / invalid-input-response 時，錯誤碼在 error-codes
        recaptchaErrorCode:
          (Array.isArray(recaptchaResult.raw?.["error-codes"]) ? recaptchaResult.raw["error-codes"][0] : null) ??
          null,
        recaptchaAction: recaptchaResult.action ?? null,
      });
    }
  }

  const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}`);
  const voteRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventIdStr}/votes/${deviceIdStr}`);
  const profileBreakingRef = db.doc(`profiles/${uid}/breaking_votes/${eventIdStr}`);

  let debug = null;
  try {
    await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new HttpsError("not-found", "Event not found");
      }
      const profileBreakingSnap = await tx.get(profileBreakingRef);
      if (profileBreakingSnap.exists) {
        throw new HttpsError("failed-precondition", "Already voted on this topic", {
          code: "breaking-already-voted",
        });
      }
      const voteSnap = await tx.get(voteRef);
      if (voteSnap.exists) {
        throw new HttpsError("failed-precondition", "Already voted on this topic", {
          code: "breaking-already-voted",
        });
      }
      const eventData = eventSnap.data();
      const optionsArr = Array.isArray(eventData?.options) ? eventData.options : [];
      const optionsLen = optionsArr.length;
      const optionClamped =
        optionsLen > 0 ? Math.max(0, Math.min(Math.floor(Number(option)), optionsLen - 1)) : 0;
      tx.set(voteRef, {
        optionIndex: optionClamped,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(profileBreakingRef, {
        optionIndex: optionClamped,
        deviceId: deviceIdStr,
        eventId: eventIdStr,
        createdAt: FieldValue.serverTimestamp(),
      });
      // 突發戰區 Vote-to-Reveal：同一 Transaction 內更新活動文件的票數統計，供前端投票後顯示結果條
      const existingVoteCounts = eventSnap.data()?.vote_counts;
      const voteCountsIsMapLike =
        existingVoteCounts && typeof existingVoteCounts === "object" && !Array.isArray(existingVoteCounts);

      // 先用 set(merge) 確保必要結構存在，避免後續 update 因型別不符或缺欄位而失敗。
      if (!voteCountsIsMapLike) {
        tx.set(
          eventRef,
          {
            vote_counts: {},
            total_votes: 0,
          },
          { merge: true }
        );
      }

      const voteCountPath = `vote_counts.${optionClamped}`;
      tx.update(eventRef, {
        [voteCountPath]: FieldValue.increment(1),
        total_votes: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

      debug = { eventId: eventIdStr, optionClamped, voteCountPath };
    });

    // 附帶回傳寫入後的統計（多 1 次 read）
    const afterSnap = await eventRef.get();
    const afterData = afterSnap.exists ? afterSnap.data() : null;
    const totalVotes = typeof afterData?.total_votes === "number" ? afterData.total_votes : 0;
    const voteCounts =
      afterData?.vote_counts && typeof afterData.vote_counts === "object" ? afterData.vote_counts : {};

    return { ok: true, debug, total_votes: totalVotes, vote_counts: voteCounts };
  } catch (txnErr) {
    if (txnErr instanceof HttpsError) {
      throw txnErr;
    }
    functions.logger.error("[submitBreakingVote][transaction]", {
      message: txnErr?.message,
      code: txnErr?.code,
      eventId: eventIdStr,
      deviceId: deviceIdStr,
    });
    throw new HttpsError(
      "failed-precondition",
      "Breaking vote transaction failed",
      { code: "breaking-transaction-failed", detail: txnErr?.message }
    );
  }
}

/**
 * issueAdRewardToken — 簽發廣告獎勵 Token（看完廣告後由前端呼叫）。
 *
 * 設計意圖：當未使用 AD_REWARD_VERIFY_ENDPOINT 時，改由後端以 AD_REWARD_SIGNING_SECRET 簽發短期 Token，
 * 前端於「廣告觀看完成」後呼叫此函式取得 Token，再傳入 resetPosition。僅限已登入使用者，且 Token 5 分鐘有效。
 * Gen2 須以 defineSecret 綁定 Secret Manager，否則執行期 process.env 常為空導致簽發失敗。
 */
export const issueAdRewardToken = onCall(
  { ...CALLABLE_HTTP_OPTS, secrets: [adRewardSigningSecret] },
  async (request) => {
  requireAuth(request);

  const placement =
    typeof request.data?.placement === "string" ? request.data.placement.trim() : "reset_position";

  const signingSecret = resolveAdRewardSigningSecret(adRewardSigningSecret);
  if (!signingSecret) {
    functions.logger.error("[issueAdRewardToken] AD_REWARD_SIGNING_SECRET is empty after resolve");
    throw new HttpsError("failed-precondition", "Ad reward signing not configured", {
      code: "ad-reward-signing-missing",
    });
  }

  try {
    const token = signAdRewardToken(
      {
        placement,
        uid: request.auth.uid,
      },
      signingSecret
    );
    return { token };
  } catch (err) {
    // 不將內部錯誤訊息（如 Secret 未設定）回傳給客戶端，避免資訊洩漏
    console.error("[issueAdRewardToken]", err?.message);
    throw new HttpsError("internal", "Failed to issue ad reward token", {
      code: "ad-reward-issue-failed",
    });
  }
}
);

/**
 * getFilteredSentimentSummary — 漏斗篩選後之情緒聚合（Admin 讀 votes，客戶端 Rules 已禁止掃描）。
 * 與原 useSentimentData 查詢語意對齊：starId + 可選 team/ageGroup/gender/country/city。
 */
export const getFilteredSentimentSummary = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);

  const payload = request.data || {};
  const starIdRaw = typeof payload.starId === "string" ? payload.starId.trim() : "";
  const starId = starIdRaw || STAR_ID;

  let pageSize = Number(payload.pageSize);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 200;
  pageSize = Math.min(Math.floor(pageSize), 500);

  const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
  const fieldMap = {
    team: "voterTeam",
    ageGroup: "ageGroup",
    gender: "gender",
    country: "country",
    city: "city",
  };

  let q = db.collection("votes").where("starId", "==", starId);
  for (const [key, fieldName] of Object.entries(fieldMap)) {
    const v = filters[key];
    if (v != null && String(v).trim() !== "") {
      q = q.where(fieldName, "==", String(v).trim());
    }
  }
  q = q.limit(pageSize);

  try {
    const snap = await q.get();
    const rows = snap.docs.map((d) => {
      const row = d.data() || {};
      return { id: d.id, ...row };
    });
    const summary = computeSentimentSummaryFromRows(rows);
    return {
      ok: true,
      summary,
      rows,
      rowCount: rows.length,
      truncated: snap.size >= pageSize,
    };
  } catch (err) {
    console.error("[getFilteredSentimentSummary]", err?.message);
    throw new HttpsError("internal", "Filtered sentiment query failed", {
      code: "filtered-sentiment-internal",
    });
  }
});

