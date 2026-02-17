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
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  deleteField,
  increment,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import i18n from "../i18n/config";
import { GLOBAL_SUMMARY_DOC_ID, PRO_STANCES, ANTI_STANCES, STANCE_KEYS } from "../lib/constants";

const STAR_ID = "lbj";

/**
 * 重新投票（Revote）：符合 Firestore「先讀後寫」Transaction 規則。
 *
 * 寫入即預備：投票時已將該筆 vote 的 docId 寫入 profiles/{uid}.currentVoteId。
 * 順序（Read-then-Write，不可打亂）：
 *   (1) 所有 tx.get() 先執行：get profile → 若有 currentVoteId 則 get voteDoc；
 *   (2) 最後才執行所有寫入：tx.update(profile)、tx.delete(voteRef)。
 * 成功則整組提交，失敗則整組撤回，原子性不變；呼叫 update/delete 前絕無隱藏 get()。
 *
 * @param {string} uid - 當前用戶 UID
 * @param {boolean} [resetProfile=false] - 若為 true，一併清除年齡／性別／球隊／國家／城市並設 hasProfile 為 false
 * @returns {Promise<{ deletedVoteId: string | null }>}
 */
export async function revokeVote(uid, resetProfile = false) {
  if (!db || !uid) throw new Error(i18n.t("common:error_missingDbOrUid"));

  const profileRef = doc(db, "profiles", uid);

  let deletedVoteId = null;

  try {
    await runTransaction(db, async (tx) => {
      // ========== 階段一：所有讀取（禁止在後續出現任何 get） ==========
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap?.exists?.())
        throw new Error(i18n.t("common:error_profileNotFoundRevote"));
      const profileData = profileSnap.data?.() ?? {};
      if (profileData.hasVoted !== true)
        throw new Error(i18n.t("common:error_hasNotVoted"));

      const raw = profileData?.currentVoteId;
      const voteDocId = typeof raw === "string" && raw.length > 0 ? raw : null;
      let voteData = null;

      const globalSummaryRef = doc(db, "warzoneStats", GLOBAL_SUMMARY_DOC_ID);
      let globalSnap = null;
      if (voteDocId) {
        const voteRef = doc(db, "votes", voteDocId);
        const voteSnap = await tx.get(voteRef);
        voteData = voteSnap?.exists?.() ? voteSnap.data() : null;
        globalSnap = await tx.get(globalSummaryRef);
      }

      // ========== 階段二：所有寫入（此前不得再呼叫 get） ==========
      const updatePayload = {
        hasVoted: false,
        currentStance: deleteField(),
        currentReasons: deleteField(),
        currentVoteId: deleteField(),
        updatedAt: serverTimestamp(),
      };
      if (resetProfile) {
        updatePayload.ageGroup = deleteField();
        updatePayload.gender = deleteField();
        updatePayload.voterTeam = deleteField();
        updatePayload.country = deleteField();
        updatePayload.city = deleteField();
        updatePayload.hasProfile = false;
      }
      tx.update(profileRef, updatePayload);

      if (voteDocId) {
        tx.delete(doc(db, "votes", voteDocId));
        deletedVoteId = voteDocId;
        const status = voteData?.status;
        if (voteData?.hadWarzoneStats === true) {
          const wid =
            (voteData.warzoneId || voteData.voterTeam || "").trim();
          if (wid && status) {
            const warzoneStatsRef = doc(db, "warzoneStats", wid);
            tx.set(
              warzoneStatsRef,
              {
                totalVotes: increment(-1),
                [status]: increment(-1),
              },
              { merge: true }
            );
          }
        }
        if (globalSnap?.exists?.() && status) {
          const globalData = globalSnap.data();
          const prevTotal = typeof globalData.totalVotes === "number" ? globalData.totalVotes : 0;
          const newTotal = Math.max(0, prevTotal - 1);
          const stanceCounts = {};
          STANCE_KEYS.forEach((key) => {
            const v = typeof globalData[key] === "number" ? globalData[key] : 0;
            stanceCounts[key] = key === status ? Math.max(0, v - 1) : v;
          });
          const reasonCountsLike = { ...(typeof globalData.reasonCountsLike === "object" && globalData.reasonCountsLike !== null && !Array.isArray(globalData.reasonCountsLike) ? globalData.reasonCountsLike : {}) };
          const reasonCountsDislike = { ...(typeof globalData.reasonCountsDislike === "object" && globalData.reasonCountsDislike !== null && !Array.isArray(globalData.reasonCountsDislike) ? globalData.reasonCountsDislike : {}) };
          (voteData.reasons || []).forEach((r) => {
            if (PRO_STANCES.has(status)) {
              reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) - 1;
              if (reasonCountsLike[r] <= 0) delete reasonCountsLike[r];
            } else if (ANTI_STANCES.has(status)) {
              reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) - 1;
              if (reasonCountsDislike[r] <= 0) delete reasonCountsDislike[r];
            }
          });
          const countryCounts = { ...(typeof globalData.countryCounts === "object" && globalData.countryCounts !== null && !Array.isArray(globalData.countryCounts) ? globalData.countryCounts : {}) };
          const cc = String(voteData.country ?? "").toUpperCase().slice(0, 2);
          if (cc && countryCounts[cc]) {
            const cur = countryCounts[cc];
            const pro = Math.max(0, (cur.pro ?? 0) - (PRO_STANCES.has(status) ? 1 : 0));
            const anti = Math.max(0, (cur.anti ?? 0) - (ANTI_STANCES.has(status) ? 1 : 0));
            if (pro > 0 || anti > 0) countryCounts[cc] = { pro, anti };
            else delete countryCounts[cc];
          }
          tx.set(
            globalSummaryRef,
            {
              totalVotes: newTotal,
              ...stanceCounts,
              reasonCountsLike,
              reasonCountsDislike,
              countryCounts,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } else if (import.meta.env.DEV) {
        console.warn(
          "[AccountService] 無 currentVoteId（舊資料或未寫入），僅重置 Profile，靜默跳過刪除",
        );
      }
    });

    if (import.meta.env.DEV) {
      const list = [
        deletedVoteId
          ? `votes/${deletedVoteId} 已刪除`
          : "(無 currentVoteId，僅重置 Profile)",
        `profiles/${uid} hasVoted → false, currentStance / currentReasons / currentVoteId 已清除`,
        ...(resetProfile
          ? [
              "ageGroup / gender / voterTeam / country / city 已 deleteField，hasProfile → false",
            ]
          : []),
      ];
      console.log("[AccountService] 重新投票 — 數據清理清單", list);
    }

    return { deletedVoteId };
  } catch (err) {
    const errMsg =
      err?.message != null && typeof err.message === "string"
        ? err.message
        : String(err);
    if (import.meta.env.DEV) {
      console.warn("[AccountService] revokeVote 錯誤 — userId:", uid, errMsg);
    }
    throw err;
  }
}

/**
 * 帳號刪除 — Firestore 全域清理（不含 Auth）。
 * 禁止在 Transaction 內使用 query()。正確做法：Transaction 外 getDocs(query) 取得 docId 列表，Transaction 內僅 tx.get(profileRef) + tx.delete。
 *
 * @param {string} uid - 要刪除的用戶 UID
 * @returns {Promise<{ deletedProfile: boolean, deletedVoteIds: string[] }>}
 */
export async function deleteAccountData(uid) {
  if (!db || !uid) throw new Error(i18n.t("common:error_missingDbOrUid"));

  const profileRef = doc(db, "profiles", uid);
  const votesRef = collection(db, "votes");

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

  const deletedVoteIds = [];

  await runTransaction(db, async (tx) => {
    // Transaction 內僅允許：tx.get(profileRef) 與後續 tx.delete，不得再 get 其他 query。
    const profileSnap = await tx.get(profileRef);

    // 最後的動作：所有刪除（先 profile 再 votes）
    if (profileSnap?.exists?.()) tx.delete(profileRef);
    idsToDelete.forEach((id) => {
      deletedVoteIds.push(id);
      tx.delete(doc(db, "votes", id));
    });
  });

  if (import.meta.env.DEV) {
    const list = [
      `profiles/${uid} 已刪除`,
      ...(deletedVoteIds ?? []).map((id) => `votes/${id}`),
    ];
    console.log("[AccountService] 帳號刪除 — 數據清理清單", list);
  }

  return {
    deletedProfile: true,
    deletedVoteIds,
  };
}
