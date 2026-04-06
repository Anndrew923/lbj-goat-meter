/**
 * Emulator PoC: 驗證 generateBattleCard（戰報資料僅由後端讀取 profiles/{uid}，請求 body 可為空 data）。
 *
 * 設計意圖：
 * - 使用 Functions Emulator 的測試授權 JWT，模擬「帶 auth 的 callable 請求」。
 * - 請先在 Emulator Firestore 建立 profiles/{FIREBASE_UID}（含 photoURL / currentStance / warzoneId 等）再執行。
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || "lbj-goat-meter";
const REGION = process.env.FUNCTIONS_REGION || "us-central1";
const FUNCTIONS_HOST = process.env.FUNCTIONS_HOST || "127.0.0.1:5001";
/** 與 Hosting 一致；Callable 走 fetch 時若無 Referer，部分 API Key Referrer 限制會擋下請求。 */
const CALLABLE_REFERER = process.env.CALLABLE_REFERER || "https://lbj-goat-meter.web.app";
const USE_PRODUCTION =
  process.env.USE_PRODUCTION === "1" ||
  process.env.USE_PRODUCTION === "true" ||
  (process.env.CALLABLE_URL || "").trim().startsWith("https://");
const OUTPUT_DIR = process.env.OUTPUT_DIR || "tmp";
const TEST_UID = process.env.FIREBASE_UID || "test-admin-123";

function makeEmulatorJwt(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      user_id: uid,
      sub: uid,
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      iat: now,
      exp: now + 60 * 60,
    })
  ).toString("base64url");
  return `${header}.${body}.`;
}

function resolveCallableUrl() {
  const explicit = (process.env.CALLABLE_URL || "").trim();
  if (explicit) return explicit;
  if (USE_PRODUCTION) {
    return `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/generateBattleCard`;
  }
  return `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/generateBattleCard`;
}

function resolveAuthBearer() {
  const fromEnv = (process.env.FIREBASE_ID_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  if (USE_PRODUCTION) {
    throw new Error(
      "USE_PRODUCTION 需要設定 FIREBASE_ID_TOKEN（Firebase Auth ID Token），且 Firestore 須存在 profiles/{該 Token 的 uid}。"
    );
  }
  return makeEmulatorJwt(TEST_UID);
}

async function main() {
  const url = resolveCallableUrl();
  const token = resolveAuthBearer();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: CALLABLE_REFERER,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: {} }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // noop
  }

  if (!res.ok) {
    throw new Error(`request failed (${res.status}): ${JSON.stringify(json || text)}`);
  }
  const result = json?.result || json?.data || json;
  if (!result?.url) {
    throw new Error("missing url in response");
  }
  if (typeof result?.downloadBase64 === "string" && result.downloadBase64.length > 0) {
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(OUTPUT_DIR, { recursive: true });
      const outputPath = `${OUTPUT_DIR}/ssr-battlecard.png`;
      await writeFile(outputPath, Buffer.from(result.downloadBase64, "base64"));
      console.log(`[SSR BattleCard PoC] image saved: ${outputPath}`);
    });
  }
  console.log("[SSR BattleCard PoC] success");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[SSR BattleCard PoC] unexpected error:", err);
  process.exit(1);
});
