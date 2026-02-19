/**
 * VoteService — 投票／撤票／聚合核心引擎
 *
 * 設計意圖：
 * - 所有投票與撤票的 Firestore Transaction 集中於此，保證單一 runTransaction 與減法公式一致。
 * - submitVote / revokeVote 封裝原子寫入；computeGlobalDeductions / computeWarzoneDeltas 供 deleteAccountData 複用減法邏輯。
 */

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  increment,
  deleteField,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import i18n from "../i18n/config";
import {
  GLOBAL_SUMMARY_DOC_ID,
  STANCE_KEYS,
  PRO_STANCES,
  ANTI_STANCES,
  getInitialGlobalSummary,
} from "../lib/constants";
import { isObject } from "../utils/typeUtils";

const STAR_ID = "lbj";

/**
 * 提交一票（含設備鎖：一設備一票，與 revokeVote / deleteAccountData 連動解鎖）。
 *
 * @param {string} userId - Firebase Auth UID
 * @param {{ selectedStance: string, selectedReasons: string[], deviceId?: string }} payload - 立場、理由、設備識別碼（必填，用於 device_locks）
 * @param {(key: string) => string} getMessage - i18n 鍵→文案，例：(key) => t(key)
 * @throws 若 device_locks/${deviceId} 已存在且 active === true，拋出 error_deviceAlreadyVoted
 */
export async function submitVote(userId, { selectedStance, selectedReasons, deviceId }, getMessage) {
  if (typeof getMessage !== "function") throw new Error("getMessage is required");
  if (!db || !userId) throw new Error(getMessage("common:error_missingDbOrUid"));
  const deviceIdStr = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!deviceIdStr) throw new Error(getMessage("common:error_deviceIdRequired"));

  const profileRef = doc(db, "profiles", userId);
  const votesRef = collection(db, "votes");
  const globalSummaryRef = doc(db, "warzoneStats", GLOBAL_SUMMARY_DOC_ID);
  const deviceLockRef = doc(db, "device_locks", deviceIdStr);

  await runTransaction(db, async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap?.exists?.()) throw new Error(getMessage("common:completeProfileFirst"));
    const data = profileSnap?.data?.() ?? {};
    if (data.hasVoted === true) throw new Error(getMessage("common:alreadyVoted"));
    const warzoneId = String(data.warzoneId ?? data.voterTeam ?? "").trim();
    if (!warzoneId) throw new Error(getMessage("common:error_warzoneRequired"));

    const deviceLockSnap = await tx.get(deviceLockRef);
    if (deviceLockSnap?.exists?.()) {
      const lockData = deviceLockSnap.data() ?? {};
      if (lockData.active === true) throw new Error(getMessage("common:error_deviceAlreadyVoted"));
    }

    const globalSnap = await tx.get(globalSummaryRef);
    const globalData = !globalSnap?.exists?.()
      ? getInitialGlobalSummary()
      : (() => {
          const d = globalSnap.data();
          return {
            totalVotes: typeof d.totalVotes === "number" ? d.totalVotes : 0,
            recentVotes: Array.isArray(d.recentVotes) ? d.recentVotes : [],
            reasonCountsLike: isObject(d.reasonCountsLike) ? d.reasonCountsLike : {},
            reasonCountsDislike: isObject(d.reasonCountsDislike) ? d.reasonCountsDislike : {},
            countryCounts: isObject(d.countryCounts) ? d.countryCounts : {},
            ...Object.fromEntries(STANCE_KEYS.map((k) => [k, typeof d[k] === "number" ? d[k] : 0])),
          };
        })();

    const newVoteRef = doc(votesRef);
    tx.set(newVoteRef, {
      starId: STAR_ID,
      userId,
      deviceId: deviceIdStr,
      status: selectedStance,
      reasons: selectedReasons,
      warzoneId,
      voterTeam: warzoneId,
      ageGroup: data.ageGroup ?? "",
      gender: data.gender ?? "",
      country: data.country ?? "",
      city: data.city ?? "",
      hadWarzoneStats: true,
      createdAt: serverTimestamp(),
    });
    tx.set(deviceLockRef, {
      lastVoteId: newVoteRef.id,
      active: true,
      updatedAt: serverTimestamp(),
    });

    const warzoneStatsRef = doc(db, "warzoneStats", warzoneId);
    tx.set(warzoneStatsRef, { totalVotes: increment(1), [selectedStance]: increment(1) }, { merge: true });

    const newTotal = globalData.totalVotes + 1;
    const stanceCounts = {};
    STANCE_KEYS.forEach((key) => {
      stanceCounts[key] = globalData[key] + (key === selectedStance ? 1 : 0);
    });
    const newRecentEntry = {
      status: selectedStance,
      city: data.city ?? "",
      country: data.country ?? "",
      voterTeam: warzoneId,
      createdAt: Timestamp.now(),
    };
    const newRecentVotes = [newRecentEntry, ...globalData.recentVotes].slice(0, 10);
    const reasonCountsLike = { ...(globalData.reasonCountsLike ?? {}) };
    const reasonCountsDislike = { ...(globalData.reasonCountsDislike ?? {}) };
    (selectedReasons || []).forEach((r) => {
      if (PRO_STANCES.has(selectedStance)) reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1;
      else if (ANTI_STANCES.has(selectedStance)) reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1;
    });
    const countryCounts = { ...(globalData.countryCounts ?? {}) };
    const cc = String(data.country ?? "").toUpperCase().slice(0, 2);
    if (cc) {
      const prev = countryCounts[cc] ?? { pro: 0, anti: 0 };
      countryCounts[cc] = {
        pro: (prev.pro ?? 0) + (PRO_STANCES.has(selectedStance) ? 1 : 0),
        anti: (prev.anti ?? 0) + (ANTI_STANCES.has(selectedStance) ? 1 : 0),
      };
    }
    tx.set(
      globalSummaryRef,
      {
        totalVotes: newTotal,
        ...stanceCounts,
        recentVotes: newRecentVotes,
        reasonCountsLike,
        reasonCountsDislike,
        countryCounts,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    tx.update(profileRef, {
      hasVoted: true,
      currentStance: selectedStance,
      currentReasons: selectedReasons,
      currentVoteId: newVoteRef.id,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function revokeVote(uid, resetProfile = false) {
  if (!db || !uid) throw new Error(i18n.t("common:error_missingDbOrUid"));

  const profileRef = doc(db, "profiles", uid);
  const globalSummaryRef = doc(db, "warzoneStats", GLOBAL_SUMMARY_DOC_ID);
  let deletedVoteId = null;

  await runTransaction(db, async (tx) => {
    const profileSnap = await tx.get(profileRef);
    if (!profileSnap?.exists?.()) throw new Error(i18n.t("common:error_profileNotFoundRevote"));
    const profileData = profileSnap.data?.() ?? {};
    if (profileData.hasVoted !== true) throw new Error(i18n.t("common:error_hasNotVoted"));

    const raw = profileData?.currentVoteId;
    const voteDocId = typeof raw === "string" && raw.length > 0 ? raw : null;
    let voteData = null;
    let globalSnap = null;

    if (voteDocId) {
      const voteRef = doc(db, "votes", voteDocId);
      const voteSnap = await tx.get(voteRef);
      voteData = voteSnap?.exists?.() ? voteSnap.data() : null;
      globalSnap = await tx.get(globalSummaryRef);
    }

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
      const voteDeviceId = typeof voteData?.deviceId === "string" ? voteData.deviceId.trim() : "";
      if (voteDeviceId) {
        tx.delete(doc(db, "device_locks", voteDeviceId));
      }
      tx.delete(doc(db, "votes", voteDocId));
      deletedVoteId = voteDocId;
      const status = voteData?.status;
      if (voteData?.hadWarzoneStats === true) {
        const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
        if (wid && status) {
          tx.set(
            doc(db, "warzoneStats", wid),
            { totalVotes: increment(-1), [status]: increment(-1) },
            { merge: true }
          );
        }
      }
      if (globalSnap?.exists?.() && status) {
        const globalData = globalSnap.data();
        const deduction = computeGlobalDeductions(globalData, [{ id: voteDocId, data: voteData }]);
        tx.set(globalSummaryRef, { ...deduction, updatedAt: serverTimestamp() }, { merge: true });
      }
    } else if (import.meta.env.DEV) {
      console.warn("[VoteService] 無 currentVoteId，僅重置 Profile");
    }
  });

  if (import.meta.env.DEV) {
    console.log("[VoteService] 重新投票 — deletedVoteId:", deletedVoteId);
  }

  return { deletedVoteId };
}

/**
 * 純函數：依現有 global 與多筆 vote 計算扣減後的 global 欄位（不含 recentVotes、updatedAt）。
 * 若 globalData 為 null/undefined 則以 getInitialGlobalSummary() 為底。
 *
 * @param {Record<string, unknown> | null | undefined} globalData - global_summary 的 data()
 * @param {{ id: string, data: Record<string, unknown> }[]} voteDataList
 * @returns {Record<string, unknown>} 可寫入 global_summary 的 payload（由呼叫端加上 updatedAt）
 */
export function computeGlobalDeductions(globalData, voteDataList) {
  if (globalData == null || typeof globalData !== "object") {
    globalData = getInitialGlobalSummary();
  }
  const hasValidVotes = voteDataList.some((v) => v.data?.status && STANCE_KEYS.includes(v.data.status));
  if (voteDataList.length === 0 || !hasValidVotes) {
    return {
      totalVotes: typeof globalData.totalVotes === "number" ? globalData.totalVotes : 0,
      ...Object.fromEntries(STANCE_KEYS.map((k) => [k, typeof globalData[k] === "number" ? globalData[k] : 0])),
      reasonCountsLike: isObject(globalData.reasonCountsLike) ? globalData.reasonCountsLike : {},
      reasonCountsDislike: isObject(globalData.reasonCountsDislike) ? globalData.reasonCountsDislike : {},
      countryCounts: isObject(globalData.countryCounts) ? globalData.countryCounts : {},
    };
  }

  let newTotal = typeof globalData.totalVotes === "number" ? globalData.totalVotes : 0;
  const stanceCounts = {};
  STANCE_KEYS.forEach((key) => {
    stanceCounts[key] = typeof globalData[key] === "number" ? globalData[key] : 0;
  });
  const reasonCountsLike = { ...(isObject(globalData.reasonCountsLike) ? globalData.reasonCountsLike : {}) };
  const reasonCountsDislike = { ...(isObject(globalData.reasonCountsDislike) ? globalData.reasonCountsDislike : {}) };
  const countryCounts = { ...(isObject(globalData.countryCounts) ? globalData.countryCounts : {}) };

  for (const { data: voteData } of voteDataList) {
    const status = voteData?.status;
    if (!status || !STANCE_KEYS.includes(status)) continue;
    newTotal = Math.max(0, newTotal - 1);
    STANCE_KEYS.forEach((key) => {
      stanceCounts[key] = key === status ? Math.max(0, (stanceCounts[key] ?? 0) - 1) : (stanceCounts[key] ?? 0);
    });
    (voteData.reasons || []).forEach((r) => {
      if (PRO_STANCES.has(status)) {
        reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) - 1;
        if (reasonCountsLike[r] <= 0) delete reasonCountsLike[r];
      } else if (ANTI_STANCES.has(status)) {
        reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) - 1;
        if (reasonCountsDislike[r] <= 0) delete reasonCountsDislike[r];
      }
    });
    const cc = String(voteData.country ?? "").toUpperCase().slice(0, 2);
    if (cc && countryCounts[cc]) {
      const cur = countryCounts[cc];
      const pro = Math.max(0, (cur.pro ?? 0) - (PRO_STANCES.has(status) ? 1 : 0));
      const anti = Math.max(0, (cur.anti ?? 0) - (ANTI_STANCES.has(status) ? 1 : 0));
      if (pro > 0 || anti > 0) countryCounts[cc] = { pro, anti };
      else delete countryCounts[cc];
    }
  }

  return {
    totalVotes: newTotal,
    ...stanceCounts,
    reasonCountsLike,
    reasonCountsDislike,
    countryCounts,
  };
}

/**
 * 純函數：依多筆 vote 計算各 warzoneId 的扣減量（負數），供 deleteAccountData 以 increment 寫入 warzoneStats。
 *
 * @param {{ id: string, data: Record<string, unknown> }[]} voteDataList
 * @returns {Record<string, { totalVotes: number, [key: string]: number }>} { [warzoneId]: { totalVotes: -n, goat?: -x, ... } }
 */
export function computeWarzoneDeltas(voteDataList) {
  const warzoneDeltas = {};
  for (const { data: voteData } of voteDataList) {
    const status = voteData?.status;
    if (!status || !STANCE_KEYS.includes(status)) continue;
    if (voteData?.hadWarzoneStats !== true) continue;
    const wid = (voteData.warzoneId || voteData.voterTeam || "").trim();
    if (!wid) continue;
    if (!warzoneDeltas[wid]) warzoneDeltas[wid] = { totalVotes: 0 };
    warzoneDeltas[wid].totalVotes -= 1;
    warzoneDeltas[wid][status] = (warzoneDeltas[wid][status] ?? 0) - 1;
  }
  return warzoneDeltas;
}
