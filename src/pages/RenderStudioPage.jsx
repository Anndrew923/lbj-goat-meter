import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BattleCard from "../components/BattleCard";

function resolveFunctionsBaseUrl() {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "us-central1";
  if (!projectId) return "";
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

export default function RenderStudioPage() {
  const { jobId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const token = (searchParams.get("token") || "").trim();

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__RENDER_READY__ = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!jobId.trim() || !token) return;
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
  }, [payload]);

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
