import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BattleCard from "../components/BattleCard";

function resolveFunctionsBaseUrl() {
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    (typeof window !== "undefined" && window.location?.hostname?.includes("lbj-goat-meter")
      ? "lbj-goat-meter"
      : "");
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "us-central1";
  if (!projectId) return "";
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

function isPuppeteerStudioHref() {
  if (typeof window === "undefined") return false;
  if (window.location.href.includes("mode=puppeteer")) return true;
  return new URLSearchParams(window.location.search || "").get("mode") === "puppeteer";
}

export default function RenderStudioPage() {
  const { jobId: jobIdParam = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation("common");
  const [payload, setPayload] = useState(null);
  const token = (searchParams.get("token") || "").trim();
  const jobId = typeof jobIdParam === "string" ? jobIdParam.trim() : "";
  const isPuppeteer = isPuppeteerStudioHref();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!jobId || !token) return;

      const boot =
        typeof window !== "undefined" ? window.__RENDER_STUDIO_BOOT__ : null;
      if (
        boot &&
        boot.jobId === jobId &&
        boot.renderToken === token &&
        boot.payload
      ) {
        if (!cancelled) setPayload(boot.payload);
        try {
          delete window.__RENDER_STUDIO_BOOT__;
        } catch {
          // 忽略
        }
        return;
      }

      const base = resolveFunctionsBaseUrl();
      if (!base) return;
      const url = `${base}/getRenderStudioPayload?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { method: "GET", credentials: "omit" });
      if (!res.ok || cancelled) return;
      const json = await res.json().catch(() => null);
      if (!json || cancelled) return;
      setPayload(json.payload ?? null);
    };
    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  useEffect(() => {
    if (!payload || typeof window === "undefined") return;

    const triggerSignal = () => {
      window.__RENDER_READY__ = true;
      if (!document.getElementById("render-ready-signal")) {
        const div = document.createElement("div");
        div.id = "render-ready-signal";
        document.body.appendChild(div);
      }
    };

    let timeoutId = 0;
    let cancelled = false;

    if (isPuppeteer) {
      // 極速路徑：payload 就緒後 1.5s 發訊；頭像未載入時 BattleCard 身份區已有占位
      timeoutId = window.setTimeout(() => {
        if (!cancelled) triggerSignal();
      }, 1500);
    } else {
      const markReady = async () => {
        const imagePromises = Array.from(document.images || []).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
        });
        await Promise.allSettled([document.fonts?.ready, Promise.allSettled(imagePromises)]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      markReady()
        .then(() => {
          if (!cancelled) triggerSignal();
        })
        .catch(() => {
          if (!cancelled) triggerSignal();
        });
    }

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [payload, isPuppeteer]);

  const reasonLabels = useMemo(() => {
    if (Array.isArray(payload?.reasonLabels) && payload.reasonLabels.length) return payload.reasonLabels;
    if (typeof payload?.evidenceText === "string" && payload.evidenceText.trim()) return [payload.evidenceText.trim()];
    return [];
  }, [payload]);

  if (!payload) {
    return (
      <div id="render-studio-root" className="fixed inset-0 m-0 flex items-center justify-center bg-black text-zinc-400">
        {t("loadingRenderStudio")}
      </div>
    );
  }

  return (
    <div
      id="render-studio-root"
      className="fixed inset-0 m-0 overflow-hidden bg-black"
      style={
        isPuppeteer
          ? { width: 1080, height: 1080, maxWidth: "100vw", maxHeight: "100vh", position: "relative" }
          : undefined
      }
    >
      <div
        className="relative bg-black"
        style={isPuppeteer ? { width: 1080, height: 1080 } : { width: "100%", height: "100%" }}
      >
        <BattleCard
          open
          onClose={() => {}}
          photoURL={payload.avatarUrl || ""}
          displayName={payload.displayName || ""}
          voterTeam={payload.teamLabel || ""}
          teamLabel={payload.teamLabel || ""}
          status={(payload.status || "GOAT").toLowerCase()}
          reasonLabels={reasonLabels}
          city=""
          country=""
          rankLabel={payload.rankLabel || ""}
          teamColors={{
            primary: payload.theme?.primaryColor ?? "#C8102E",
            secondary: payload.theme?.secondaryColor ?? "#2E003E",
          }}
          battleTitle={payload.battleTitle || ""}
          battleSubtitle={payload.battleSubtitle || ""}
          exportSceneMode
          disablePortal
          renderScale={3}
          isExportReady
        />
      </div>
    </div>
  );
}
