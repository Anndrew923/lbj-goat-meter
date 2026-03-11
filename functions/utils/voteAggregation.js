// utils/voteAggregation.js
// 設計意圖：
// - 後端 Cloud Functions 端的純函數聚合邏輯，與前端 VoteService 中的邏輯保持等價。
// - 專門服務於 revoke / resetPosition 等需要「扣回統計」的流程，確保戰區與全球統計一致性。

const STANCE_KEYS = ["goat", "fraud", "king", "mercenary", "machine", "stat_padder"];

const PRO_STANCES = new Set(["goat", "king", "machine"]);
const ANTI_STANCES = new Set(["fraud", "stat_padder", "mercenary"]);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getInitialGlobalSummary() {
  return {
    totalVotes: 0,
    recentVotes: [],
    reasonCountsLike: {},
    reasonCountsDislike: {},
    countryCounts: {},
    ...Object.fromEntries(STANCE_KEYS.map((k) => [k, 0])),
  };
}

/**
 * 依現有 global 與多筆 vote 計算扣減後的 global 欄位（不含 recentVotes、updatedAt）。
 * 與前端 VoteService.computeGlobalDeductions 等價，確保前後端減法行為一致。
 *
 * @param {Record<string, any> | null | undefined} globalData
 * @param {{ id: string, data: Record<string, any> }[]} voteDataList
 * @returns {Record<string, any>}
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

