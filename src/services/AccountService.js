/**
 * AccountService — 重新投票與帳號刪除的數據層
 *
 * 設計意圖：
 * - 所有涉及數據變動的操作均以 runTransaction 保證原子性，避免「只刪了 profile 卻沒刪 vote」等孤兒數據。
 * - 與業務 UI 解耦，便於單元測試與 Boss 在 DEV 模式下透過「數據清理清單」檢查資料庫。
 *
 * 潛在影響：若未來新增「立場全域計數」聚合文件（如 aggregates/votesByStance），
 *           需在本 Transaction 內同步遞減對應計數，以維持統計一致性。
 */

import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  increment,
} from "firebase/firestore";
import { db, ensureFreshAppCheckToken } from "../lib/firebase";
import i18n from "../i18n/config";
import { GLOBAL_EVENTS_COLLECTION, GLOBAL_SUMMARY_DOC_ID, STANCE_KEYS } from "../lib/constants";
import { computeGlobalDeductions, computeWarzoneDeltas } from "./VoteService";

const STAR_ID = "lbj";

/**
 * 儲存 FCM Token 至 profile，供後端「戰況即時快報」推播鎖定發送對象。
 * 設計意圖：arrayUnion 避免同一設備多開分頁重複寫入造成陣列膨脹；lastActive 供後續清理過期 token 使用。
 * 呼叫端須確保 profiles/{uid} 已存在（例如僅在 hasProfile 為 true 時註冊推播），否則 updateDoc 會拋錯。
 *
 * @param {string} uid - Firebase Auth UID
 * @param {string} token - FCM device token
 */
export async function saveFCMToken(uid, token) {
  if (!uid || !token) return;
  const userRef = doc(db, "profiles", uid);
  await updateDoc(userRef, {
    fcmTokens: arrayUnion(token),
    lastActive: new Date(),
  });
}

/**
 * 帳號刪除 — Firestore 全域清理（不含 Auth）。
 * 防禦性重構：刪除帳號前必須在同一個 Transaction 內同步扣減 global_summary 與 warzoneStats，
 * 杜絕「刪帳號未扣票」導致用戶可循環開帳號灌票。扣票失敗則整筆 Transaction 回滾，帳號不刪。
 *
 * 禁止在 Transaction 內使用 query()。正確做法：Transaction 外 getDocs(query) 取得 docId 列表，
 * Transaction 內：階段一所有讀取（profile、global_summary、各 vote、各 global_events 突發話題）→
 * 階段二扣票寫入 → 突發戰區扣票與存證刪除 → 刪 votes → 刪 profile。
 *
 * @param {string} uid - 要刪除的用戶 UID
 * @returns {Promise<{ deletedProfile: boolean, deletedVoteIds: string[] }>}
 */
export async function deleteAccountData(uid) {
  if (!db || !uid) throw new Error(i18n.t("common:error_missingDbOrUid"));

  const profileRef = doc(db, "profiles", uid);
  const votesRef = collection(db, "votes");
  const globalSummaryRef = doc(db, "warzoneStats", GLOBAL_SUMMARY_DOC_ID);

  const voteQuery = query(
    votesRef,
    where("userId", "==", uid),
    where("starId", "==", STAR_ID),
    limit(500),
  );
  // 禁止在 runTransaction 內使用 tx.get(voteQuery)。先在外用 getDocs 取得 docId 列表。
  const voteSnap = await getDocs(voteQuery);
  const idsToDelete = (voteSnap?.docs ?? [])
    .map((d) => d?.id)
    .filter((id) => typeof id === "string" && id.length > 0);

  const breakingVotesQuery = query(collection(db, "profiles", uid, "breaking_votes"), limit(500));
  const breakingSnap = await getDocs(breakingVotesQuery);
  const breakingEntries = (breakingSnap?.docs ?? []).map((d) => {
    const data = d.data() || {};
    const rawOpt = data.optionIndex;
    const optionIndex =
      typeof rawOpt === "number" && Number.isFinite(rawOpt)
        ? Math.floor(rawOpt)
        : typeof rawOpt === "string"
          ? parseInt(rawOpt, 10)
          : 0;
    return {
      eventId: d.id,
      optionIndex: Number.isFinite(optionIndex) ? optionIndex : 0,
      deviceId: typeof data.deviceId === "string" ? data.deviceId.trim() : "",
    };
  });

  const deletedVoteIds = [];

  try {
    await ensureFreshAppCheckToken();
    await runTransaction(db, async (tx) => {
      // ========== 階段一：所有讀取（禁止在後續出現任何 get） ==========
      const profileSnap = await tx.get(profileRef);
      const globalSnap = await tx.get(globalSummaryRef);
      const voteDataList = [];
      for (const id of idsToDelete) {
        const voteRef = doc(db, "votes", id);
        const voteSnapInner = await tx.get(voteRef);
        if (voteSnapInner?.exists?.()) {
          voteDataList.push({ id, data: voteSnapInner.data() });
        }
      }

      const breakingEventReads = [];
      for (const b of breakingEntries) {
        const eventRef = doc(db, GLOBAL_EVENTS_COLLECTION, b.eventId);
        const evSnap = await tx.get(eventRef);
        breakingEventReads.push({ ...b, eventSnap: evSnap });
      }

      // ========== 階段二：扣票（使用 VoteService 內核，與 revokeVote 減法一致） ==========
      if (voteDataList.length > 0) {
        const warzoneDeltas = computeWarzoneDeltas(voteDataList);
        Object.entries(warzoneDeltas).forEach(([wid, deltas]) => {
          const payload = { totalVotes: increment(deltas.totalVotes), updatedAt: serverTimestamp() };
          STANCE_KEYS.forEach((key) => {
            if (typeof deltas[key] === "number" && deltas[key] !== 0) payload[key] = increment(deltas[key]);
          });
          tx.set(doc(db, "warzoneStats", wid), payload, { merge: true });
        });

        if (globalSnap?.exists?.()) {
          const globalData = globalSnap.data();
          const deduction = computeGlobalDeductions(globalData, voteDataList);
          tx.set(globalSummaryRef, { ...deduction, updatedAt: serverTimestamp() }, { merge: true });
        }
      }

      // ========== 階段二b：突發戰區 global_events 扣票與子集合清理（與 submitBreakingVote 寫入對稱） ==========
      for (const row of breakingEventReads) {
        const { eventId, optionIndex, deviceId, eventSnap } = row;
        const breakingProofRef = doc(db, "profiles", uid, "breaking_votes", eventId);
        if (eventSnap?.exists?.()) {
          const evData = eventSnap.data() || {};
          const optionsArr = Array.isArray(evData.options) ? evData.options : [];
          const optionsLen = optionsArr.length;
          const rawOi = Number(optionIndex);
          const clampedOi =
            optionsLen > 0 && Number.isFinite(rawOi)
              ? Math.max(0, Math.min(Math.floor(rawOi), optionsLen - 1))
              : 0;
          const voteCountPath = `vote_counts.${clampedOi}`;
          tx.update(doc(db, GLOBAL_EVENTS_COLLECTION, eventId), {
            total_votes: increment(-1),
            [voteCountPath]: increment(-1),
            updatedAt: serverTimestamp(),
          });
        }
        if (deviceId) {
          tx.delete(doc(db, GLOBAL_EVENTS_COLLECTION, eventId, "votes", deviceId));
        }
        tx.delete(breakingProofRef);
      }

      // ========== 階段三：刪除 device_locks（與 vote 連動解鎖）、再刪除 votes 文件 ==========
      const deviceIdsToUnlock = [
        ...new Set(
          voteDataList
            .map((v) => (typeof v.data?.deviceId === "string" ? v.data.deviceId.trim() : ""))
            .filter(Boolean),
        ),
      ];
      deviceIdsToUnlock.forEach((deviceId) => tx.delete(doc(db, "device_locks", deviceId)));
      idsToDelete.forEach((id) => {
        deletedVoteIds.push(id);
        tx.delete(doc(db, "votes", id));
      });

      // ========== 階段四：刪除 profile（扣票成功後才執行） ==========
      if (profileSnap?.exists?.()) tx.delete(profileRef);
    });

    if (import.meta.env.DEV) {
      const list = [
        `profiles/${uid} 已刪除`,
        ...deletedVoteIds.map((id) => `votes/${id}`),
        ...(breakingEntries.length > 0
          ? [`global_events 突發票已扣減並清除 ${breakingEntries.length} 筆存證`]
          : []),
        ...(deletedVoteIds.length > 0 ? ["warzoneStats/global_summary 已同步扣票"] : []),
      ];
      console.log("[AccountService] 帳號刪除 — 數據清理清單", list);
    }

    return {
      deletedProfile: true,
      deletedVoteIds,
    };
  } catch (err) {
    const errMsg = err?.message != null && typeof err.message === "string" ? err.message : String(err);
    if (import.meta.env.DEV) {
      console.warn("[AccountService] deleteAccountData 錯誤 — userId:", uid, errMsg);
    }
    throw err;
  }
}
