/**
 * 與前端 useSentimentData.computeSentimentSummary 等價之伺服器聚合，供 getFilteredSentimentSummary 使用。
 * 維持與 voteAggregation / global_summary 相同的立場與 pro/anti 語意。
 */
const STANCE_KEYS = ["goat", "fraud", "king", "mercenary", "machine", "stat_padder"];
const PRO_STANCES = new Set(["goat", "king", "machine"]);
const ANTI_STANCES = new Set(["fraud", "stat_padder", "mercenary"]);

/**
 * @param {Array<Record<string, unknown>>} list
 * @returns {Record<string, unknown>}
 */
export function computeSentimentSummaryFromRows(list) {
  const votes = Array.isArray(list) ? list : [];
  const totalVotes = votes.length;
  const byStance = Object.fromEntries(STANCE_KEYS.map((k) => [k, 0]));
  const reasonCountsLike = {};
  const reasonCountsDislike = {};
  const countryCounts = {};

  for (const vote of votes) {
    const status = typeof vote?.status === "string" ? vote.status : "";
    if (STANCE_KEYS.includes(status)) {
      byStance[status] = (byStance[status] ?? 0) + 1;
    }

    const reasons = Array.isArray(vote?.reasons) ? vote.reasons : [];
    if (PRO_STANCES.has(status)) {
      for (const r of reasons) {
        if (r != null && String(r).trim() !== "") {
          reasonCountsLike[r] = (reasonCountsLike[r] ?? 0) + 1;
        }
      }
    } else if (ANTI_STANCES.has(status)) {
      for (const r of reasons) {
        if (r != null && String(r).trim() !== "") {
          reasonCountsDislike[r] = (reasonCountsDislike[r] ?? 0) + 1;
        }
      }
    }

    const cc = String(vote?.country ?? "")
      .toUpperCase()
      .slice(0, 2);
    if (cc) {
      const prev = countryCounts[cc] ?? { pro: 0, anti: 0 };
      countryCounts[cc] = {
        pro: prev.pro + (PRO_STANCES.has(status) ? 1 : 0),
        anti: prev.anti + (ANTI_STANCES.has(status) ? 1 : 0),
      };
    }
  }

  return {
    totalVotes,
    ...byStance,
    reasonCountsLike,
    reasonCountsDislike,
    countryCounts,
  };
}
