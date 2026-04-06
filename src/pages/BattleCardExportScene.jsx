import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { auth, getFirebaseFunctions } from "../lib/firebase";

function downloadBlob(blob, filename = "LBJ-GOAT-Meter.jpg") {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
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
    downloadBlob(new Blob([bytes], { type: "image/jpeg" }), "LBJ-GOAT-Meter.jpg");
    return;
  }

  // 優先轉 blob：可避免跨網域 URL 在部分瀏覽器忽略 download 屬性而直接導頁。
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download fetch failed: ${res.status}`);
    const blob = await res.blob();
    const name =
      blob.type === "image/jpeg" || blob.type === "image/jpg"
        ? "LBJ-GOAT-Meter.jpg"
        : blob.type === "image/png"
          ? "LBJ-GOAT-Meter.png"
          : "LBJ-GOAT-Meter.jpg";
    downloadBlob(blob, name);
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
  "not-found": "找不到戰區檔案，請先完成戰區登錄後再匯出 (404: Profile missing)",
  "invalid-argument": "請求參數無效 (400)；請重新整理後再試或更新至最新版",
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
  const [loadingText, setLoadingText] = useState(() => t("loadingRenderStudio"));
  const [diagnosticError, setDiagnosticError] = useState(null);

  const exportPayload = location.state?.exportPayload ?? null;
  const returnTo = typeof location.state?.returnTo === "string" ? location.state.returnTo : "/vote";

  useEffect(() => {
    setLoadingText(t("loadingRenderStudio"));
    const timer = window.setTimeout(() => {
      setLoadingText(t("loadingVerdictGrace"));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [t]);

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

    let cancelled = false;

    const run = async () => {
      try {
        const user = await waitForAuthenticatedUser();
        if (cancelled) return;
        if (!user) {
          throw makeAuthExpiredDiagnostic();
        }
        await user.getIdToken();
        if (cancelled) return;
        if (!auth?.currentUser || auth.currentUser.uid !== user.uid) {
          throw makeAuthExpiredDiagnostic();
        }

        const fns = getFirebaseFunctions();
        if (!fns) {
          throw new Error("Firebase Functions unavailable");
        }
        /** 須略長於雲端 generateBattleCard timeoutSeconds（180s + 冷啟 + Puppeteer），否則客戶端先 deadline-exceeded 且閘道 504 不帶 CORS。 */
        const callable = httpsCallable(fns, "generateBattleCard", { timeout: 200_000 });
        /**
         * 方案 B：與 BattleCard 匯出 state.exportPayload 一致，後端以 profiles 校驗身分／warzone，顯示文案與色票用客戶端值。
         */
        const ep = exportPayload;
        const res = await callable({
          uid: user.uid,
          battleTitle: ep.battleTitle,
          battleSubtitle: ep.battleSubtitle,
          rankLabel: ep.rankLabel,
          teamLabel: ep.teamLabel,
          teamColors: ep.teamColors,
          reasonLabels: ep.reasonLabels,
          voterTeam: ep.voterTeam,
          regionText: ep.regionText,
          verdictSectionLabel: ep.verdictSectionLabel,
          metaFooterLine: ep.metaFooterLine,
          disclaimerLine: ep.disclaimerLine,
        });
        if (cancelled) return;
        const data = res?.data?.result ? res.data.result : res?.data;
        const url = data?.downloadUrl || data?.url;
        const downloadBase64 = data?.downloadBase64 || "";
        const hasBase64 = typeof downloadBase64 === "string" && downloadBase64.length > 0;
        if (!hasBase64 && (!url || typeof url !== "string")) {
          throw new Error("Missing battle card payload");
        }
        await triggerDownload(url, downloadBase64);
        if (cancelled) return;
        navigate(returnTo, { replace: true });
      } catch (err) {
        if (cancelled) return;
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
        if (!cancelled) setIsRunning(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [exportPayload, navigate, returnTo]);

  return (
    <div className="fixed inset-0 z-[12000] bg-black flex items-center justify-center overflow-hidden">
      {isRunning ? (
        <div className="absolute bottom-12 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-king-gold/30 border-t-king-gold rounded-full animate-spin" />
          <p className="animate-pulse text-king-gold font-medium text-center px-6 leading-relaxed">
            {loadingText}
          </p>
        </div>
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
