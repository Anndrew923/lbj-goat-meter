import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { auth, getFirebaseFunctions } from "../lib/firebase";

const DIMENSION_KEYS = ["GOAT", "FRAUD", "KING", "MERCENARY", "MACHINE", "STAT_PADDER"];
const STANCE_TO_LABEL_KEY = {
  goat: "GOAT",
  fraud: "FRAUD",
  king: "KING",
  mercenary: "MERCENARY",
  machine: "MACHINE",
  stat_padder: "STAT_PADDER",
};

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildLabelPayloadFromWarzoneStats(warzoneStats, status) {
  const totalVotes = Number(warzoneStats?.totalVotes);
  const labels = {};
  if (Number.isFinite(totalVotes) && totalVotes > 0) {
    for (const key of DIMENSION_KEYS) {
      const sourceKey = key === "STAT_PADDER" ? "stat_padder" : key.toLowerCase();
      const count = Number(warzoneStats?.[sourceKey]) || 0;
      labels[key] = clampPercent((count / totalVotes) * 100);
    }
  } else {
    for (const key of DIMENSION_KEYS) labels[key] = 0;
    const boostedKey = STANCE_TO_LABEL_KEY[status] || "GOAT";
    labels[boostedKey] = 100;
  }
  return labels;
}

function buildEvidenceText(reasonLabels) {
  if (!Array.isArray(reasonLabels) || reasonLabels.length === 0) return "20 火力 All-NBA";
  return reasonLabels.slice(0, 2).join(" / ");
}

function buildThemePayload(exportPayload) {
  const teamColors = exportPayload?.teamColors && typeof exportPayload.teamColors === "object"
    ? exportPayload.teamColors
    : {};
  const primaryColor = /^#[0-9a-fA-F]{6}$/.test(String(teamColors.primary || "").trim())
    ? String(teamColors.primary).trim()
    : "#C8102E";
  const secondaryColor = /^#[0-9a-fA-F]{6}$/.test(String(teamColors.secondary || "").trim())
    ? String(teamColors.secondary).trim()
    : "#2E003E";
  return {
    primaryColor,
    secondaryColor,
    accentColor: "#FFD700",
    backgroundGradient: {
      start: primaryColor,
      end: secondaryColor,
    },
  };
}

function resolveBgKey(exportPayload, theme) {
  const teamHint = `${exportPayload?.teamLabel || ""} ${exportPayload?.voterTeam || ""}`.toLowerCase();
  if (teamHint.includes("celtic") || teamHint.includes("bos")) return "celtics";
  const primary = String(theme?.primaryColor || "").replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(primary)) {
    const r = Number.parseInt(primary.slice(0, 2), 16);
    const g = Number.parseInt(primary.slice(2, 4), 16);
    const b = Number.parseInt(primary.slice(4, 6), 16);
    if (g > r + 16 && g > b + 16) return "celtics";
  }
  return "base";
}

function downloadBlob(blob) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = "LBJ-GOAT-Meter.png";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

async function triggerDownload(url, downloadBase64) {
  if (typeof downloadBase64 === "string" && downloadBase64.length > 0) {
    const raw = atob(downloadBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: "image/png" }));
    return;
  }

  // 優先轉 blob：可避免跨網域 URL 在部分瀏覽器忽略 download 屬性而直接導頁。
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download fetch failed: ${res.status}`);
    downloadBlob(await res.blob());
    return;
  } catch (e) {
    console.error("Download Fallback Triggered", e);
    throw new Error("Download failed in blob mode");
  }
}

const DIAGNOSTIC_ERROR_MAP = Object.freeze({
  unauthenticated: "登入狀態失效 (401: Auth Required)",
  "permission-denied": "伺服器拒絕訪問 (403: IAM/AppCheck Denied)",
  "deadline-exceeded": "伺服器運算超時 (504: SSR Timeout)",
  internal: "後端渲染引擎崩潰 (500: Internal Error)",
});

function normalizeFunctionsErrorCode(rawCode) {
  const s = String(rawCode || "").trim();
  if (!s) return "unknown";
  return s.replace(/^functions\//, "");
}

function toDiagnosticError(err) {
  const normalizedCode = normalizeFunctionsErrorCode(err?.code);
  const mappedMessage = DIAGNOSTIC_ERROR_MAP[normalizedCode] || "SSR 匯出失敗，請稍後重試";
  const rawMessage = typeof err?.message === "string" && err.message.trim() ? err.message.trim() : "Unknown error";
  return {
    code: normalizedCode,
    message: rawMessage,
    mappedMessage,
    timestamp: new Date().toISOString(),
    details: err?.details ?? null,
  };
}

function makeAuthExpiredDiagnostic() {
  return {
    code: "unauthenticated",
    message: "檢測到登入狀態過期，請重新登入後再試",
    mappedMessage: DIAGNOSTIC_ERROR_MAP.unauthenticated,
    timestamp: new Date().toISOString(),
    details: null,
  };
}

function waitForAuthenticatedUser(timeoutMs = 8000) {
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      unsub();
      resolve(user ?? null);
    });
  });
}

export default function BattleCardExportScene() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(true);
  const [diagnosticError, setDiagnosticError] = useState(null);
  const runningRef = useRef(false);

  const exportPayload = location.state?.exportPayload ?? null;
  const returnTo = typeof location.state?.returnTo === "string" ? location.state.returnTo : "/vote";

  const callablePayload = useMemo(() => {
    if (!exportPayload) return null;
    const theme = buildThemePayload(exportPayload);
    return {
      displayName: exportPayload.displayName || t("anonymousWarrior"),
      avatarUrl: exportPayload.photoURL || "",
      labels: buildLabelPayloadFromWarzoneStats(exportPayload.warzoneStats, exportPayload.status),
      battleSubtitle: exportPayload.battleSubtitle || t("battleCardTagline"),
      evidenceText: buildEvidenceText(exportPayload.reasonLabels),
      regionText: [exportPayload.city, exportPayload.country].filter(Boolean).join("・") || t("global"),
      theme,
      bgKey: exportPayload?.bgKey || resolveBgKey(exportPayload, theme),
    };
  }, [exportPayload, t]);

  useEffect(() => {
    if (!exportPayload) {
      setIsRunning(false);
      setDiagnosticError({
        code: "internal",
        message: "Missing export payload",
        mappedMessage: DIAGNOSTIC_ERROR_MAP.internal,
        timestamp: new Date().toISOString(),
        details: null,
      });
      return;
    }
    if (!callablePayload) {
      setIsRunning(false);
      setDiagnosticError(makeAuthExpiredDiagnostic());
      return;
    }
    if (!callablePayload || runningRef.current) return;
    runningRef.current = true;

    const run = async () => {
      try {
        const user = await waitForAuthenticatedUser();
        if (!user) {
          throw makeAuthExpiredDiagnostic();
        }
        await user.getIdToken();
        if (!auth?.currentUser || auth.currentUser.uid !== user.uid) {
          throw makeAuthExpiredDiagnostic();
        }

        const fns = getFirebaseFunctions();
        if (!fns) {
          throw new Error("Firebase Functions unavailable");
        }
        const callable = httpsCallable(fns, "generateBattleCard");
        const res = await callable({
          ...callablePayload,
          uid: user.uid,
        });
        const data = res?.data?.result ? res.data.result : res?.data;
        const url = data?.downloadUrl || data?.url;
        const downloadBase64 = data?.downloadBase64 || "";
        if (!url || typeof url !== "string") {
          throw new Error("Missing battle card URL");
        }
        await triggerDownload(url, downloadBase64);
        navigate(returnTo, { replace: true });
      } catch (err) {
        const parsed = toDiagnosticError(err);
        setDiagnosticError(parsed);
        console.error("[BattleCardExportScene] SSR export failed", {
          error: err,
          code: parsed.code,
          message: parsed.message,
          details: parsed.details,
          timestamp: parsed.timestamp,
        });
      } finally {
        setIsRunning(false);
      }
    };

    run();
  }, [callablePayload, exportPayload, navigate, returnTo, t]);

  return (
    <div className="fixed inset-0 z-[12000] bg-black flex items-center justify-center overflow-hidden">
      {isRunning ? (
        <div className="absolute bottom-6 text-white/70 text-sm">{t("generatingHighResReport")}</div>
      ) : null}
      {!isRunning && diagnosticError ? (
        <div className="absolute bottom-6 px-3 py-3 rounded bg-red-950/80 border border-red-400/50 text-red-200 text-xs max-w-[92vw]">
          <p className="font-semibold mb-1">生成失敗：{diagnosticError.mappedMessage}</p>
          <pre className="whitespace-pre-wrap leading-relaxed text-[11px] text-red-100/95">
{`[Diagnostic Info]
Code: ${diagnosticError.code}
Message: ${diagnosticError.message}
Timestamp: ${diagnosticError.timestamp}`}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
