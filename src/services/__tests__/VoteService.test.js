/**
 * VoteService 單元測試 — computeGlobalDeductions & computeWarzoneDeltas
 *
 * 測試策略：
 *   - 只測試可觀察、可複現的純函數行為，不測試實作細節。
 *   - Mock 所有 Firebase / Cloud Functions 依賴；stanceCore / typeUtils 使用真實實作，
 *     確保「立場模型本身的正確性」也在保護範圍之內。
 *   - 每個 describe 從乾淨基底開始，避免測試間狀態污染。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// ----------------------------------------------------------------
// 隔離 Firebase 依賴：這些模組在 Node 測試環境中無法初始化
// ----------------------------------------------------------------
vi.mock("firebase/firestore", () => ({ Timestamp: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: vi.fn() }));
vi.mock("../../lib/firebase", () => ({
  default: {},
  getFirebaseFunctions: vi.fn(() => null),
  isFirebaseReady: false,
  auth: null,
  db: null,
}));
vi.mock("../../lib/appConfig", () => ({
  STAR_ID: "LBJ",
  PROJECT_APP_ID: "goat_meter",
  GLOBAL_EVENTS_COLLECTION: "global_events",
  GLOBAL_SUMMARY_DOC_ID: "summary",
}));
vi.mock("../../utils/firebaseCallableError", () => ({
  getCallableDetailsCode: vi.fn((err) => err?.code ?? ""),
}));
vi.mock("../../utils/normalizeBreakingOptionIndex", () => ({
  normalizeBreakingOptionIndex: vi.fn((i) => Number(i)),
}));
vi.mock("../RecaptchaService", () => ({
  getRecaptchaToken: vi.fn(async () => "mock-token"),
}));
vi.mock("../GoldenKeyService", () => ({
  createGoldenKeySignature: vi.fn(async () => ({
    xGoatTimestamp: "ts",
    xGoatSignature: "sig",
  })),
  GOLDEN_KEY_ACTIONS: { SUBMIT_VOTE: "sv", SUBMIT_BREAKING_VOTE: "sbv" },
}));
vi.mock("../MetaAnalyticsService", () => ({
  trackSubmitVote: vi.fn(async () => {}),
}));

// stanceCore 與 typeUtils 使用真實實作（純 JS，無外部依賴）
import { computeGlobalDeductions, computeWarzoneDeltas } from "../VoteService.js";
import { STANCE_KEYS, getInitialGlobalSummary } from "../../lib/stanceCore.js";

// ================================================================
// 測試輔助工具
// ================================================================

/** 建立完整的 global_summary 快照，所有欄位明確設定 */
function makeGlobal(overrides = {}) {
  return {
    totalVotes: 10,
    goat: 3,
    fraud: 2,
    king: 1,
    mercenary: 1,
    machine: 2,
    stat_padder: 1,
    reasonCountsLike: {},
    reasonCountsDislike: {},
    countryCounts: {},
    ...overrides,
  };
}

/** 建立合法的 vote data 物件 */
function makeVote(status, overrides = {}) {
  return {
    id: `vote-${Math.random()}`,
    data: { status, reasons: [], country: "", ...overrides },
  };
}

// ================================================================
// computeGlobalDeductions
// ================================================================

describe("computeGlobalDeductions", () => {
  // ---- 基底行為 ----

  it("空 voteDataList 回傳原始 globalData 的各計數不變", () => {
    const global = makeGlobal({ totalVotes: 5, goat: 3 });
    const result = computeGlobalDeductions(global, []);
    expect(result.totalVotes).toBe(5);
    expect(result.goat).toBe(3);
  });

  it("空 voteDataList 但含無效立場，仍回傳不變", () => {
    const global = makeGlobal({ totalVotes: 5 });
    const result = computeGlobalDeductions(global, [
      makeVote("invalid_stance"),
    ]);
    // hasValidVotes = false → early return
    expect(result.totalVotes).toBe(5);
  });

  it("null globalData 自動以 getInitialGlobalSummary() 為底", () => {
    const initial = getInitialGlobalSummary();
    const result = computeGlobalDeductions(null, [makeVote("goat")]);
    // totalVotes 從 0 扣減後仍受 Math.max(0,...) 保護
    expect(result.totalVotes).toBe(0);
    // 所有立場計數至少為 0
    STANCE_KEYS.forEach((k) => {
      expect(result[k]).toBeGreaterThanOrEqual(0);
    });
    expect(initial).toBeTruthy(); // sanity check
  });

  it("undefined globalData 自動以 getInitialGlobalSummary() 為底", () => {
    const result = computeGlobalDeductions(undefined, [makeVote("fraud")]);
    expect(result.totalVotes).toBeGreaterThanOrEqual(0);
  });

  // ---- 計數扣減 ----

  it("goat 投票：totalVotes 與 goat 各減 1", () => {
    const global = makeGlobal({ totalVotes: 10, goat: 3 });
    const result = computeGlobalDeductions(global, [makeVote("goat")]);
    expect(result.totalVotes).toBe(9);
    expect(result.goat).toBe(2);
    // 其他立場不受影響
    expect(result.fraud).toBe(global.fraud);
    expect(result.king).toBe(global.king);
  });

  it("anti 立場 fraud：totalVotes 與 fraud 各減 1", () => {
    const global = makeGlobal({ totalVotes: 5, fraud: 2 });
    const result = computeGlobalDeductions(global, [makeVote("fraud")]);
    expect(result.totalVotes).toBe(4);
    expect(result.fraud).toBe(1);
  });

  it("多票不同立場：totalVotes 扣除投票總數", () => {
    const global = makeGlobal({ totalVotes: 10, goat: 3, fraud: 2 });
    const votes = [makeVote("goat"), makeVote("fraud"), makeVote("king")];
    const result = computeGlobalDeductions(global, votes);
    expect(result.totalVotes).toBe(7);
    expect(result.goat).toBe(2);
    expect(result.fraud).toBe(1);
    expect(result.king).toBe(0);
  });

  // ---- Math.max(0) 地板保護 ----

  it("totalVotes 已為 0 時不會降至負數", () => {
    const global = makeGlobal({ totalVotes: 0, goat: 0 });
    const result = computeGlobalDeductions(global, [makeVote("goat")]);
    expect(result.totalVotes).toBe(0);
    expect(result.goat).toBe(0);
  });

  it("立場計數為 1 時扣減後為 0，不為負數", () => {
    const global = makeGlobal({ machine: 1 });
    const result = computeGlobalDeductions(global, [makeVote("machine")]);
    expect(result.machine).toBe(0);
  });

  // ---- reasonCountsLike（pro 立場：goat, king, machine） ----

  it("pro 立場理由扣減 reasonCountsLike", () => {
    const global = makeGlobal({
      reasonCountsLike: { r_rings: 5, r_finals: 3 },
      goat: 3,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { reasons: ["r_rings"] }),
    ]);
    expect(result.reasonCountsLike.r_rings).toBe(4);
    expect(result.reasonCountsLike.r_finals).toBe(3); // 未觸及
  });

  it("pro 立場理由扣減後歸零，鍵自動刪除", () => {
    const global = makeGlobal({
      reasonCountsLike: { r_rings: 1 },
      goat: 1,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { reasons: ["r_rings"] }),
    ]);
    expect(result.reasonCountsLike.r_rings).toBeUndefined();
    expect(Object.keys(result.reasonCountsLike)).toHaveLength(0);
  });

  it("pro 立場多個理由同時扣減", () => {
    const global = makeGlobal({
      reasonCountsLike: { r_rings: 3, r_finals: 2 },
      goat: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { reasons: ["r_rings", "r_finals"] }),
    ]);
    expect(result.reasonCountsLike.r_rings).toBe(2);
    expect(result.reasonCountsLike.r_finals).toBe(1);
  });

  // ---- reasonCountsDislike（anti 立場：fraud, mercenary, stat_padder） ----

  it("anti 立場理由扣減 reasonCountsDislike", () => {
    const global = makeGlobal({
      reasonCountsDislike: { r_selfish: 4 },
      fraud: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("fraud", { reasons: ["r_selfish"] }),
    ]);
    expect(result.reasonCountsDislike.r_selfish).toBe(3);
  });

  it("anti 立場理由扣減後歸零，鍵自動刪除", () => {
    const global = makeGlobal({
      reasonCountsDislike: { r_selfish: 1 },
      mercenary: 1,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("mercenary", { reasons: ["r_selfish"] }),
    ]);
    expect(result.reasonCountsDislike.r_selfish).toBeUndefined();
  });

  it("pro 立場理由不影響 reasonCountsDislike，anti 理由不影響 reasonCountsLike", () => {
    const global = makeGlobal({
      reasonCountsLike: { r_rings: 3 },
      reasonCountsDislike: { r_selfish: 3 },
      goat: 2,
      fraud: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { reasons: ["r_selfish"] }), // pro 立場帶 anti 理由 — 不扣 dislike
      makeVote("fraud", { reasons: ["r_rings"] }),  // anti 立場帶 pro 理由 — 不扣 like
    ]);
    // pro 立場的 reasons 只影響 reasonCountsLike
    expect(result.reasonCountsLike.r_selfish).toBeUndefined(); // 不存在於 like
    // anti 立場的 reasons 只影響 reasonCountsDislike
    expect(result.reasonCountsDislike.r_rings).toBeUndefined(); // 不存在於 dislike
    // 原有的正確計數不受影響
    expect(result.reasonCountsLike.r_rings).toBe(3);
    expect(result.reasonCountsDislike.r_selfish).toBe(3);
  });

  // ---- countryCounts ----

  it("pro 立場投票：countryCounts[cc].pro 減 1", () => {
    const global = makeGlobal({
      countryCounts: { US: { pro: 4, anti: 2 } },
      goat: 3,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { country: "US" }),
    ]);
    expect(result.countryCounts.US.pro).toBe(3);
    expect(result.countryCounts.US.anti).toBe(2);
  });

  it("anti 立場投票：countryCounts[cc].anti 減 1", () => {
    const global = makeGlobal({
      countryCounts: { JP: { pro: 1, anti: 3 } },
      fraud: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("fraud", { country: "JP" }),
    ]);
    expect(result.countryCounts.JP.anti).toBe(2);
    expect(result.countryCounts.JP.pro).toBe(1);
  });

  it("國家計數 pro + anti 均歸零後，鍵自動刪除", () => {
    const global = makeGlobal({
      countryCounts: { CN: { pro: 1, anti: 0 } },
      goat: 1,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { country: "CN" }),
    ]);
    expect(result.countryCounts.CN).toBeUndefined();
  });

  it("國家計數仍有殘餘數時不刪除", () => {
    const global = makeGlobal({
      countryCounts: { CN: { pro: 2, anti: 1 } },
      goat: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { country: "CN" }),
    ]);
    expect(result.countryCounts.CN).toBeDefined();
    expect(result.countryCounts.CN.pro).toBe(1);
  });

  it("國家不在 countryCounts 中時靜默跳過，不崩潰", () => {
    const global = makeGlobal({ countryCounts: {} });
    expect(() =>
      computeGlobalDeductions(global, [makeVote("goat", { country: "XX" })])
    ).not.toThrow();
  });

  it("country 欄位為空字串時跳過 countryCounts 更新", () => {
    const global = makeGlobal({
      countryCounts: { US: { pro: 3, anti: 1 } },
      goat: 2,
    });
    const result = computeGlobalDeductions(global, [
      makeVote("goat", { country: "" }),
    ]);
    expect(result.countryCounts.US.pro).toBe(3); // 未修改
  });

  // ---- 不可變性：不汙染輸入 ----

  it("不修改傳入的 globalData 物件（回傳新物件）", () => {
    const global = makeGlobal({
      reasonCountsLike: { r_rings: 5 },
      countryCounts: { US: { pro: 3, anti: 1 } },
    });
    const originalLike = { ...global.reasonCountsLike };
    const originalCountry = JSON.stringify(global.countryCounts);
    computeGlobalDeductions(global, [makeVote("goat", { country: "US", reasons: ["r_rings"] })]);
    expect(global.reasonCountsLike).toEqual(originalLike);
    expect(JSON.stringify(global.countryCounts)).toBe(originalCountry);
  });

  // ---- 回傳結構完整性 ----

  it("回傳物件包含所有 STANCE_KEYS 欄位", () => {
    const result = computeGlobalDeductions(makeGlobal(), [makeVote("goat")]);
    STANCE_KEYS.forEach((k) => {
      expect(result).toHaveProperty(k);
    });
    expect(result).toHaveProperty("totalVotes");
    expect(result).toHaveProperty("reasonCountsLike");
    expect(result).toHaveProperty("reasonCountsDislike");
    expect(result).toHaveProperty("countryCounts");
  });
});

// ================================================================
// computeWarzoneDeltas
// ================================================================

describe("computeWarzoneDeltas", () => {
  it("空 voteDataList 回傳空物件", () => {
    expect(computeWarzoneDeltas([])).toEqual({});
  });

  it("status 不在 STANCE_KEYS 中的票不計入 delta", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "invalid", warzoneId: "LAL", hadWarzoneStats: true } },
    ]);
    expect(result).toEqual({});
  });

  it("hadWarzoneStats !== true 的票跳過（不計入 delta）", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: false } },
      { id: "v2", data: { status: "goat", warzoneId: "LAL" } }, // hadWarzoneStats 不存在
    ]);
    expect(result).toEqual({});
  });

  it("warzoneId 為空字串且無 voterTeam 時跳過", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "", hadWarzoneStats: true } },
    ]);
    expect(result).toEqual({});
  });

  it("單票 goat / LAL：產生 totalVotes: -1, goat: -1", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
    ]);
    expect(result).toEqual({ LAL: { totalVotes: -1, goat: -1 } });
  });

  it("同戰區多票：totalVotes 累計扣減", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
      { id: "v2", data: { status: "fraud", warzoneId: "LAL", hadWarzoneStats: true } },
      { id: "v3", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
    ]);
    expect(result.LAL.totalVotes).toBe(-3);
    expect(result.LAL.goat).toBe(-2);
    expect(result.LAL.fraud).toBe(-1);
  });

  it("不同戰區分別追蹤，互不干擾", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
      { id: "v2", data: { status: "fraud", warzoneId: "BOS", hadWarzoneStats: true } },
    ]);
    expect(result.LAL).toEqual({ totalVotes: -1, goat: -1 });
    expect(result.BOS).toEqual({ totalVotes: -1, fraud: -1 });
  });

  it("warzoneId 缺失時以 voterTeam 為後備", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "king", voterTeam: "LAL", hadWarzoneStats: true } },
    ]);
    expect(result).toEqual({ LAL: { totalVotes: -1, king: -1 } });
  });

  it("warzoneId 前後空白自動 trim", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "machine", warzoneId: "  LAL  ", hadWarzoneStats: true } },
    ]);
    expect(result).toEqual({ LAL: { totalVotes: -1, machine: -1 } });
  });

  it("混合有效與無效票時，只計入有效票", () => {
    const result = computeWarzoneDeltas([
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
      { id: "v2", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: false } }, // 跳過
      { id: "v3", data: { status: "invalid", warzoneId: "LAL", hadWarzoneStats: true } }, // 跳過
    ]);
    expect(result.LAL.totalVotes).toBe(-1);
    expect(result.LAL.goat).toBe(-1);
  });

  it("不修改傳入的 voteDataList（回傳全新物件）", () => {
    const votes = [
      { id: "v1", data: { status: "goat", warzoneId: "LAL", hadWarzoneStats: true } },
    ];
    const original = JSON.stringify(votes);
    computeWarzoneDeltas(votes);
    expect(JSON.stringify(votes)).toBe(original);
  });
});
