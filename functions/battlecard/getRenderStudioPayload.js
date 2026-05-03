/**
 * battlecard/getRenderStudioPayload.js — Render Studio 一次性 Token 驗證與 Payload 回傳
 *
 * 設計意圖：
 * - Puppeteer 開啟的無頭頁面無法可靠取得 Firebase App Check token，
 *   此端點走 Admin SDK，不依賴瀏覽器驗證機制，以 jobId + renderToken 雙驗證取代。
 * - 一般渲染流程已改為 generateBattleCard（setContent 全量 HTML），此端點保留供手動除錯使用。
 * - 採 HTTP GET + no-store Cache-Control：確保每次請求均重新驗證 token，不被 CDN 快取。
 */
import { onRequest } from "firebase-functions/v2/https";
import { db } from "../shared/admin.js";

export const getRenderStudioPayload = onRequest(
  {
    region: process.env.FUNCTIONS_REGION || "us-central1",
    cors: true,
    memory: "256MiB",
    timeoutSeconds: 15,
    minInstances: 0,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET") { res.status(405).json({ error: "method_not_allowed" }); return; }

    const jobId = String(req.query.jobId || "").trim();
    const token = String(req.query.token || "").trim();
    if (!jobId || !token) { res.status(400).json({ error: "missing_params" }); return; }

    try {
      const snap = await db.doc(`render_jobs/${jobId}/tokens/${token}`).get();
      if (!snap.exists) { res.status(404).json({ error: "not_found" }); return; }

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
