/**
 * account/deleteUserAccount.js — 帳號刪除：資料完整清理
 *
 * 設計意圖：
 * - 由 Admin SDK 在單一 Transaction 內完成「主戰區票扣回 + 突發戰區票扣回 + 所有文件刪除」，
 *   確保統計遞減與文件刪除同生共死，不留下不一致的中間狀態。
 * - 防禦性上限 (< 500)：若 votes 超出 Transaction 安全範圍，直接拒絕並回報，
 *   維持資料一致性優先原則，不做「部分成功」的危險操作。
 * - 前端 AccountService.deleteAccountData 依賴此 Callable，執行後再由前端呼叫 Firebase Auth deleteUser。
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue } from "../shared/admin.js";
import { STAR_ID, GLOBAL_SUMMARY_DOC_ID, GLOBAL_EVENTS_COLLECTION, CALLABLE_HTTP_OPTS } from "../shared/constants.js";
import { requireAuth } from "../shared/security.js";
import { computeGlobalDeductions } from "../utils/voteAggregation.js";

export const deleteUserAccount = onCall(CALLABLE_HTTP_OPTS, async (request) => {
  requireAuth(request);
  const uid = request.auth.uid;

  const profileRef = db.doc(`profiles/${uid}`);
  const globalSummaryRef = db.doc(`warzoneStats/${GLOBAL_SUMMARY_DOC_ID}`);
  const userVotesQuery = db.collection("votes").where("userId", "==", uid).where("starId", "==", STAR_ID).limit(500);
  const profileBreakingVotesQuery = db.collection(`profiles/${uid}/breaking_votes`).limit(500);

  try {
    await db.runTransaction(async (tx) => {
      // 四個獨立讀取並行執行，Firestore Admin SDK Transaction 支援 Promise.all 批次讀取，
      // 比循序 await 少 3 個 RTT，在帳號刪除這條低頻但高延遲的路徑上效益顯著。
      const [profileSnap, globalSnap, userVotesSnap, profileBreakingVotesSnap] = await Promise.all([
        tx.get(profileRef),
        tx.get(globalSummaryRef),
        tx.get(userVotesQuery),
        tx.get(profileBreakingVotesQuery),
      ]);

      if (userVotesSnap.size >= 500) {
        throw new HttpsError("failed-precondition", "Too many votes to delete safely in a single transaction", {
          code: "delete-account-too-many-votes",
          count: userVotesSnap.size,
        });
      }
      if (profileBreakingVotesSnap.size >= 500) {
        throw new HttpsError("failed-precondition", "Too many breaking votes to delete safely in a single transaction", {
          code: "delete-account-too-many-breaking-votes",
          count: profileBreakingVotesSnap.size,
        });
      }

      const userVoteRows = userVotesSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

      // 讀取所有 breaking votes 的對應 event 文件（仍在讀取階段）
      const breakingRows = [];
      for (const proofDoc of profileBreakingVotesSnap.docs) {
        const proofData = proofDoc.data() || {};
        const eventId = proofDoc.id;
        const eventRef = db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}`);
        const eventSnap = await tx.get(eventRef);
        breakingRows.push({ eventId, proofRef: proofDoc.ref, proofData, eventRef, eventSnap });
      }

      // 讀取所有需扣回的 warzoneStats（先讀完再寫）
      const warzoneDeltas = new Map();
      for (const row of userVoteRows) {
        const vote = row.data || {};
        if (vote.hadWarzoneStats !== true) continue;
        const status = typeof vote.status === "string" ? vote.status.trim() : "";
        const warzoneId = String(vote.warzoneId || vote.voterTeam || "").trim();
        if (!status || !warzoneId) continue;
        if (!warzoneDeltas.has(warzoneId)) warzoneDeltas.set(warzoneId, { totalVotes: 0, stance: {} });
        const bucket = warzoneDeltas.get(warzoneId);
        bucket.totalVotes -= 1;
        bucket.stance[status] = (bucket.stance[status] || 0) - 1;
      }
      const warzoneSnapById = new Map();
      for (const warzoneId of warzoneDeltas.keys()) {
        warzoneSnapById.set(warzoneId, await tx.get(db.doc(`warzoneStats/${warzoneId}`)));
      }

      // --- 寫入階段 ---

      // 扣回地方戰區票數
      for (const [warzoneId, delta] of warzoneDeltas.entries()) {
        const wzSnap = warzoneSnapById.get(warzoneId);
        const w = wzSnap?.exists ? wzSnap.data() || {} : {};
        const payload = {
          totalVotes: Math.max(0, (typeof w.totalVotes === "number" ? w.totalVotes : 0) + delta.totalVotes),
          updatedAt: FieldValue.serverTimestamp(),
        };
        Object.entries(delta.stance).forEach(([status, count]) => {
          payload[status] = Math.max(0, (typeof w[status] === "number" ? w[status] : 0) + count);
        });
        tx.set(db.doc(`warzoneStats/${warzoneId}`), payload, { merge: true });
      }

      // 扣回全域 global_summary
      if (globalSnap.exists && userVoteRows.length > 0) {
        const deduction = computeGlobalDeductions(globalSnap.data() || {}, userVoteRows);
        tx.set(globalSummaryRef, { ...deduction, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      // 扣回突發戰區票數並刪除存證
      for (const { eventId, proofData, eventRef, eventSnap, proofRef } of breakingRows) {
        if (eventSnap.exists) {
          const eventData = eventSnap.data() || {};
          const options = Array.isArray(eventData.options) ? eventData.options : [];
          const rawOptionIndex = Number(proofData.optionIndex);
          const clampedOptionIndex =
            options.length > 0 && Number.isFinite(rawOptionIndex)
              ? Math.max(0, Math.min(Math.floor(rawOptionIndex), options.length - 1))
              : 0;
          tx.update(eventRef, {
            total_votes: FieldValue.increment(-1),
            [`vote_counts.${clampedOptionIndex}`]: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        const deviceId = typeof proofData.deviceId === "string" ? proofData.deviceId.trim() : "";
        if (deviceId) tx.delete(db.doc(`${GLOBAL_EVENTS_COLLECTION}/${eventId}/votes/${deviceId}`));
        tx.delete(proofRef);
      }

      // 刪除主戰區 votes 與 device_locks
      for (const row of userVoteRows) {
        const deviceId = typeof row.data.deviceId === "string" ? row.data.deviceId.trim() : "";
        if (deviceId) tx.delete(db.doc(`device_locks/${deviceId}`));
        tx.delete(db.doc(`votes/${row.id}`));
      }

      if (profileSnap.exists) tx.delete(profileRef);
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[deleteUserAccount] Unexpected error:", err?.message);
    throw new HttpsError("internal", "Delete account failed", { code: "delete-account-internal" });
  }
});
