/**
 * battlecard/generateBattleCard.js — SSR 戰報卡渲染（Puppeteer + Chromium）
 *
 * 設計意圖（與 Spotify 離屏渲染對標）：
 * - 此函數是唯一一個使用 Puppeteer 的 Function，因此給予獨立的 memory / cpu / concurrency 配置，
 *   不與輕量 Callable 共享資源，避免 OOM 影響其他服務。
 * - concurrency: 1 是有意為之：Puppeteer 是 CPU 密集型，同實例並發渲染會 OOM；
 *   Firebase 會橫向擴展實例數來承受峰值，而非在單實例內排隊。
 * - 延遲 import battleCardVisualHtml：僅在實際渲染時才 require Puppeteer 相關依賴，
 *   不影響其他輕量 Callable 的冷啟動時間。
 * - 身分驗證（uid / voterTeam）以 profiles 為準；顯示文案（battleTitle 等）可由客戶端覆寫（方案 B），
 *   與前端 BattleCard 組件的渲染結果對齊，確保「預覽即所得」。
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../shared/admin.js";
import { requireAuth } from "../shared/security.js";
import { SSR_BATTLE_CARD_STANCE_PRIMARY } from "../battleCardConstants.js";

/** 字型／頭像／networkidle0 冷啟動須充裕：180s 超時確保首次渲染不 Timeout。 */
const GENERATE_BATTLE_CARD_TIMEOUT_SEC = 180;
/** networkidle0 上限 60s（須遠小於函式 180s），超時後強制截圖以確保至少回傳結果。 */
const BATTLE_CARD_SET_CONTENT_TIMEOUT_MS = 60_000;
/** #render-ready-signal 最長等待：字型非同步載入 + 頭像 fetch + 雙 rAF 通常 < 5s，上限 90s。 */
const BATTLE_CARD_READY_SIGNAL_MS = 90_000;

const SSR_BATTLE_CARD_MAX_TEXT = 480;
const SSR_BATTLE_CARD_MAX_REASON_ITEM = 280;
const SSR_BATTLE_CARD_MAX_REASONS = 14;
const SSR_BATTLE_CARD_MAX_DISPLAY_NAME = 120;
const SSR_BATTLE_CARD_MAX_PHOTO_URL = 2048;

function clampSsrText(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return t.length <= max ? t : t.slice(0, max);
}

function normalizeSsrHexColor(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

function parseTheme(theme) {
  const fallback = {
    primaryColor: "#C8102E",
    secondaryColor: "#2E003E",
    accentColor: "#FFD700",
    backgroundGradient: { start: "#A50022", end: "#120018" },
  };
  if (!theme || typeof theme !== "object") return fallback;
  const safeHex = (value, fb) =>
    /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim()) ? String(value).trim() : fb;
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

function parseThemeFromProfile(userData) {
  if (userData?.theme && typeof userData.theme === "object") return parseTheme(userData.theme);
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
  return arr
    .slice(0, SSR_BATTLE_CARD_MAX_REASONS)
    .map((item) => clampSsrText(String(item), SSR_BATTLE_CARD_MAX_REASON_ITEM))
    .filter(Boolean);
}

/**
 * 合併身份（以 profiles 為準）與客戶端顯示文案（可覆寫），確保 uid / voterTeam 不可偽造。
 */
function mergeBattleCardSsrPayload(authUid, userData, clientData) {
  const d = clientData && typeof clientData === "object" ? clientData : {};

  const uidIn = typeof d.uid === "string" ? d.uid.trim() : "";
  if (uidIn && uidIn !== authUid) throw new HttpsError("invalid-argument", "uid mismatch");

  const clientDisplayName = clampSsrText(typeof d.displayName === "string" ? d.displayName : "", SSR_BATTLE_CARD_MAX_DISPLAY_NAME);
  const profileDisplayName = typeof userData.displayName === "string" && userData.displayName.trim() ? userData.displayName.trim() : "";
  const displayName = clientDisplayName || profileDisplayName || "Warrior";

  const profileAvatarUrl =
    (typeof userData.avatarUrl === "string" && userData.avatarUrl.trim()) ||
    (typeof userData.photoURL === "string" && userData.photoURL.trim()) || "";
  const clientPhotoURL = clampSsrText(typeof d.photoURL === "string" ? d.photoURL : "", SSR_BATTLE_CARD_MAX_PHOTO_URL);
  const avatarUrl = clientPhotoURL || profileAvatarUrl;

  const stanceRaw = String(userData.currentStance || "GOAT").trim() || "GOAT";
  const stanceKey = stanceRaw.toLowerCase();
  const warzoneCode = String(userData.warzoneId || userData.voterTeam || "LAL").trim().toUpperCase() || "LAL";

  const clientVoter = typeof d.voterTeam === "string" ? d.voterTeam.trim().toUpperCase() : "";
  if (clientVoter && clientVoter !== warzoneCode) throw new HttpsError("invalid-argument", "voterTeam mismatch");

  const reasonLabels = Array.isArray(d.reasonLabels)
    ? normalizeClientReasonLabels(d.reasonLabels)
    : Array.isArray(userData.currentReasons)
      ? userData.currentReasons.map((r) => String(r)).filter(Boolean).slice(0, SSR_BATTLE_CARD_MAX_REASONS)
      : [];

  return {
    uid: authUid,
    displayName,
    avatarUrl,
    status: stanceKey,
    stanceDisplayPrimary: SSR_BATTLE_CARD_STANCE_PRIMARY[stanceKey] || stanceRaw.toUpperCase(),
    teamLabel: clampSsrText(typeof d.teamLabel === "string" ? d.teamLabel : "", SSR_BATTLE_CARD_MAX_TEXT) || warzoneCode,
    voterTeam: warzoneCode,
    reasonLabels,
    battleTitle: clampSsrText(typeof d.battleTitle === "string" ? d.battleTitle : "", SSR_BATTLE_CARD_MAX_TEXT) || "戰區權威裁決",
    battleSubtitle: clampSsrText(typeof d.battleSubtitle === "string" ? d.battleSubtitle : "", SSR_BATTLE_CARD_MAX_TEXT) || "VERIFIED HISTORICAL DATA",
    rankLabel: clampSsrText(typeof d.rankLabel === "string" ? d.rankLabel : "", SSR_BATTLE_CARD_MAX_TEXT) || "Verified Global Data",
    theme: themeFromClientTeamColors(d.teamColors) || parseThemeFromProfile(userData),
    regionText: clampSsrText(typeof d.regionText === "string" ? d.regionText : "", SSR_BATTLE_CARD_MAX_TEXT) || "GLOBAL",
    verdictSectionLabel: clampSsrText(typeof d.verdictSectionLabel === "string" ? d.verdictSectionLabel : "", SSR_BATTLE_CARD_MAX_TEXT) || "VERDICT / 證詞",
    metaFooterLine: clampSsrText(typeof d.metaFooterLine === "string" ? d.metaFooterLine : "", SSR_BATTLE_CARD_MAX_TEXT) || "VERIFIED DATA · GOAT METER",
    disclaimerLine: clampSsrText(typeof d.disclaimerLine === "string" ? d.disclaimerLine : "", SSR_BATTLE_CARD_MAX_TEXT) || "Fan sentiment stats. Not affiliated with any player or league.",
  };
}

/**
 * generateBattleCard — 戰報卡 SSR 渲染。
 *
 * 資源配置說明：
 * - memory 2GiB：Puppeteer 載入 Chromium + 渲染 1080x1080 頁面的最低安全值。
 * - cpu 2：加快渲染；DPR 刻意設為 1（非 2），避免雲端 OOM。
 * - concurrency 1：CPU 密集型，同實例並發渲染易 OOM；由 Firebase 橫向擴展實例數來承受峰值。
 * - timeoutSeconds 180：冷啟動 + Chromium 初始化 + 字型非同步載入，合計可能超過 60s。
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
    if (request.data?.prewarm) return { ok: true, status: "warmed" };

    const authUid = request.auth.uid;
    const userDoc = await db.doc(`profiles/${authUid}`).get();
    if (!userDoc.exists) throw new HttpsError("not-found", "Profile missing");

    const payload = mergeBattleCardSsrPayload(authUid, userDoc.data() || {}, request.data || {});

    let browser = null;
    try {
      // @sparticuz/chromium 僅支援 chrome-headless-shell；須 headless: "shell" + defaultArgs 合併。
      // chromium.headless 實際為 undefined，若直接傳入 Puppeteer 會套用 --headless=new 導致 Target closed。
      chromium.setGraphicsMode = false;
      browser = await puppeteer.launch({
        args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
        defaultViewport: null,
        executablePath: await chromium.executablePath(),
        headless: "shell",
        protocolTimeout: 180_000,
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (/google-analytics\.com|googletagmanager\.com|\/gtag\/|doubleclick\.net|facebook\.net|connect\.facebook|hotjar\.com|clarity\.ms/i.test(req.url())) {
          void req.abort();
        } else {
          void req.continue();
        }
      });

      const { buildBattleCardVisualHtml } = await import("../battleCardVisualHtml.js");
      if (typeof buildBattleCardVisualHtml !== "function") throw new Error("Visual Engine Missing");

      await page.setContent(buildBattleCardVisualHtml(payload), {
        waitUntil: "networkidle0",
        timeout: BATTLE_CARD_SET_CONTENT_TIMEOUT_MS,
      });
      await page.waitForSelector("#render-ready-signal", { timeout: BATTLE_CARD_READY_SIGNAL_MS }).catch(() => {
        console.warn("[generateBattleCard] render-ready-signal timeout, forcing capture.");
      });

      const imageBuffer = await page.screenshot({ type: "jpeg", quality: 95, fullPage: false });
      return { ok: true, downloadBase64: imageBuffer.toString("base64") };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[generateBattleCard] 渲染失敗:", err);
      throw new HttpsError("internal", `後端渲染崩潰：${err?.message ?? "unknown"}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
);
