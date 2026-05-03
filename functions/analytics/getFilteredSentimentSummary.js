/**
 * analytics/getFilteredSentimentSummary.js — 漏斗篩選後的情緒聚合查詢
 *
 * 設計意圖：
 * - Firestore Security Rules 已限制 votes 集合為「僅可讀自己的文件」，
 *   前端無法直接掃描全集合，因此透過此 Admin Callable 執行伺服器端查詢。
 * - 與前端 useSentimentData Hook 的 session cache 層搭配：有效期內的篩選結果不重複呼叫，
 *   降低 Firestore Read 成本。
 * - pageSize 上限 500 防止單次讀取過大，並以 truncated 欄位提示前端是否命中上限。
 * - 聚合邏輯委派至 computeSentimentSummaryFromRows，保持此層只做資料存取，不含計算邏輯。
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../shared/admin.js";
import { STAR_ID, CALLABLE_HTTP_OPTS } from "../shared/constants.js";
import { requireAuth } from "../shared/security.js";
import { computeSentimentSummaryFromRows } from "../utils/computeSentimentSummary.js";

export const getFilteredSentimentSummary = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);

  const payload = request.data || {};
  const starIdRaw = typeof payload.starId === "string" ? payload.starId.trim() : "";
  const starId = starIdRaw || STAR_ID;

  let pageSize = Number(payload.pageSize);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 200;
  pageSize = Math.min(Math.floor(pageSize), 500);

  const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
  const fieldMap = {
    team: "voterTeam",
    ageGroup: "ageGroup",
    gender: "gender",
    country: "country",
    city: "city",
  };

  let q = db.collection("votes").where("starId", "==", starId);
  for (const [key, fieldName] of Object.entries(fieldMap)) {
    const v = filters[key];
    if (v != null && String(v).trim() !== "") {
      q = q.where(fieldName, "==", String(v).trim());
    }
  }
  q = q.limit(pageSize);

  try {
    const snap = await q.get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() || {} }));
    const summary = computeSentimentSummaryFromRows(rows);
    return { ok: true, summary, rows, rowCount: rows.length, truncated: snap.size >= pageSize };
  } catch (err) {
    console.error("[getFilteredSentimentSummary]", err?.message);
    throw new HttpsError("internal", "Filtered sentiment query failed", {
      code: "filtered-sentiment-internal",
    });
  }
});
