import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BattleCard from "../components/BattleCard";

function resolveFunctionsBaseUrl() {
  // 與 .env / CI 注入一致；若建置漏帶 VITE_FIREBASE_PROJECT_ID，攝影棚仍須能打到同專案 HTTP function。
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    (typeof window !== "undefined" && window.location?.hostname?.includes("lbj-goat-meter")
      ? "lbj-goat-meter"
      : "");
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "us-central1";
  if (!projectId) return "";
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

export default function RenderStudioPage() {
  const { jobId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const token = (searchParams.get("token") || "").trim();
  const puppeteerMode = (searchParams.get("mode") || "").trim() === "puppeteer";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__RENDER_READY__ = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!jobId.trim() || !token) return;

      const boot =
        typeof window !== "undefined" ? window.__RENDER_STUDIO_BOOT__ : null;
      if (
        boot &&
        boot.jobId === jobId.trim() &&
        boot.renderToken === token &&
        boot.payload
      ) {
        if (!cancelled) setPayload(boot.payload);
        try {
          delete window.__RENDER_STUDIO_BOOT__;
        } catch {
          // 忽略：部分環境可能不可刪除
        }
        return;
      }

      const base = resolveFunctionsBaseUrl();
      if (!base) return;
      const url = `${base}/getRenderStudioPayload?jobId=${encodeURIComponent(jobId.trim())}&token=${encodeURIComponent(token)}`;
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
    // 後端 Puppeteer：不等待遠端頭像與 Web 字型（常拖數十秒）；版面與內建圖蓋完即截圖。
    if (puppeteerMode) {
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.__RENDER_READY__ = true;
        });
      });
      return () => window.cancelAnimationFrame(id);
    }
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
      window.__RENDER_READY__ = true;
    };
    markReady().catch(() => {
      window.__RENDER_READY__ = true;
    });
  }, [payload, puppeteerMode]);

  const reasonLabels = useMemo(() => {
    if (Array.isArray(payload?.reasonLabels) && payload.reasonLabels.length) return payload.reasonLabels;
    if (typeof payload?.evidenceText === "string" && payload.evidenceText.trim()) return [payload.evidenceText.trim()];
    return [];
  }, [payload]);

  return (
    <div id="render-studio-root" className="fixed inset-0 m-0 p-0 bg-black overflow-hidden">
      {payload ? (
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
      ) : null}
    </div>
  );
}
