/**
 * Emulator PoC: 驗證 generateBattleCard 的雙路徑：
 * 1) 外部頭像失效時使用後端預設頭像 fallback，仍可成功產圖。
 * 2) 外部頭像可讀時照常繪製。
 *
 * 設計意圖：
 * - 使用 Functions Emulator 的測試授權 JWT，模擬「帶 auth 的 callable 請求」。
 * - 預設 payload 對齊架構鎖定格式；可透過 AVATAR_URL 覆寫頭像網址，便於快速切換測試圖源。
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT || "lbj-goat-meter";
const REGION = process.env.FUNCTIONS_REGION || "us-central1";
const FUNCTIONS_HOST = process.env.FUNCTIONS_HOST || "127.0.0.1:5001";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "tmp";
const FAILING_AVATAR_URL =
  process.env.FAILING_AVATAR_URL || "https://upload.wikimedia.org/wikipedia/commons/a/a7/LeBron_James_2023.jpg";
const HEALTHY_AVATAR_URL = process.env.HEALTHY_AVATAR_URL || "https://avatars.githubusercontent.com/u/9919?v=4";

const basePayload = {
  uid: "test-admin-123",
  displayName: "The Chosen One",
  labels: {
    GOAT: 90,
    FRAUD: 5,
    KING: 95,
    MERCENARY: 10,
    MACHINE: 85,
    STAT_PADDER: 20,
  },
};

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

async function main() {
  const url = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/generateBattleCard`;
  const token = makeEmulatorJwt(basePayload.uid);

  const runCase = async (label, avatarUrl) => {
    const payload = { ...basePayload, avatarUrl };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: payload }),
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // noop
    }

    if (!res.ok) {
      throw new Error(`[${label}] request failed (${res.status}): ${JSON.stringify(json || text)}`);
    }
    const result = json?.result || json?.data || json;
    if (!result?.url) {
      throw new Error(`[${label}] missing url in response`);
    }
    if (typeof result?.downloadBase64 === "string" && result.downloadBase64.length > 0) {
      await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
        await mkdir(OUTPUT_DIR, { recursive: true });
        const outputPath = `${OUTPUT_DIR}/ssr-${label}.png`;
        await writeFile(outputPath, Buffer.from(result.downloadBase64, "base64"));
        console.log(`[SSR BattleCard PoC] ${label} image saved: ${outputPath}`);
      });
    }
    console.log(`[SSR BattleCard PoC] ${label} success`);
    console.log(JSON.stringify(result, null, 2));
  };

  await runCase("fallback-avatar", FAILING_AVATAR_URL);
  await runCase("remote-avatar", HEALTHY_AVATAR_URL);
}

main().catch((err) => {
  console.error("[SSR BattleCard PoC] unexpected error:", err);
  process.exit(1);
});
