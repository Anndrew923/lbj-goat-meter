/**
 * Production 驗收：以 Admin SDK 簽發 Custom Token → Identity Toolkit 換取 ID Token →
 * 呼叫 generateBattleCard（fetch 帶 Referer，避免 API Key Referrer 限制）。
 *
 * 必要環境變數：
 * - GOOGLE_APPLICATION_CREDENTIALS：服務帳號 JSON（或已登入 gcloud application-default）
 * - FIREBASE_WEB_API_KEY：Firebase Web API Key（與前端 VITE_FIREBASE_API_KEY 相同）
 *
 * 選用：
 * - ACCEPTANCE_UID（預設 acceptance-ssr-bot）：Custom Token 的 uid，須與 payload.uid 一致
 */

import admin from "firebase-admin";

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "lbj-goat-meter";
const REGION = process.env.FUNCTIONS_REGION || "us-central1";
const API_KEY = (process.env.FIREBASE_WEB_API_KEY || "").trim();
const HAS_ID_TOKEN = Boolean((process.env.FIREBASE_ID_TOKEN || "").trim());
const UID = (process.env.ACCEPTANCE_UID || "acceptance-ssr-bot").trim();
const CALLABLE_REFERER = process.env.CALLABLE_REFERER || "https://lbj-goat-meter.web.app";

const CALLABLE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/generateBattleCard`;

if (!HAS_ID_TOKEN && !API_KEY) {
  console.error("缺少 FIREBASE_WEB_API_KEY（或改設定 FIREBASE_ID_TOKEN 略過 Custom Token 流程）");
  process.exit(1);
}

if (!HAS_ID_TOKEN && !admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

async function idTokenFromCustomToken(customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`signInWithCustomToken failed: ${res.status} ${JSON.stringify(json)}`);
  }
  const idToken = json?.idToken;
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("signInWithCustomToken: missing idToken");
  }
  return idToken;
}

const payload = {
  uid: UID,
  displayName: "Acceptance Bot",
  avatarUrl: "https://avatars.githubusercontent.com/u/9919?v=4",
  battleTitle: "戰區傾道者",
  battleSubtitle: "戰區終道者",
  evidenceText: "",
  reasonLabels: ["結案驗收"],
  regionText: "Taipei・專業戰線",
  rankLabel: "Verified Global Data",
  teamLabel: "LAL",
  status: "GOAT",
  theme: {
    primaryColor: "#C8102E",
    secondaryColor: "#2E003E",
    accentColor: "#FFD700",
    backgroundGradient: { start: "#A50022", end: "#120018" },
  },
  bgKey: "base",
};

async function main() {
  const idTokenFromEnv = (process.env.FIREBASE_ID_TOKEN || "").trim();
  const idToken = idTokenFromEnv
    ? idTokenFromEnv
    : await idTokenFromCustomToken(await admin.auth().createCustomToken(UID));

  const res = await fetch(CALLABLE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: CALLABLE_REFERER,
      Authorization: `Bearer ${idToken}`,
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
    console.error("Callable error:", res.status, json || text);
    process.exit(1);
  }

  const result = json?.result ?? json?.data ?? json;
  const url = result?.url ?? result?.downloadUrl;
  if (!url) {
    console.error("Missing url in response:", JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log("PNG_URL:", url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
