import { describe, expect, it } from "@jest/globals";
import { computeSentimentSummaryFromRows } from "../utils/computeSentimentSummary.js";

describe("computeSentimentSummaryFromRows", () => {
  it("aggregates stances reasons and country pro/anti like client hook", () => {
    const rows = [
      { status: "goat", reasons: ["rings"], country: "us" },
      { status: "fraud", reasons: ["finals"], country: "us" },
    ];
    const s = computeSentimentSummaryFromRows(rows);
    expect(s.totalVotes).toBe(2);
    expect(s.goat).toBe(1);
    expect(s.fraud).toBe(1);
    expect(s.reasonCountsLike.rings).toBe(1);
    expect(s.reasonCountsDislike.finals).toBe(1);
    expect(s.countryCounts.US).toEqual({ pro: 1, anti: 1 });
  });
});
