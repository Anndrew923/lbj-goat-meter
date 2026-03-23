import { resolveBreakingEventLocalizedText } from "../utils/resolveBreakingEventLocalizedText.js";

const FALLBACK_TITLE = "🚨 預設標題";

describe("resolveBreakingEventLocalizedText", () => {
  it("雙語物件：zh-TW 優先於 en", () => {
    expect(
      resolveBreakingEventLocalizedText(
        { en: "English Title", "zh-TW": "中文標題" },
        FALLBACK_TITLE
      )
    ).toBe("中文標題");
  });

  it("雙語物件：僅有 en 時回傳英文", () => {
    expect(resolveBreakingEventLocalizedText({ en: "English only" }, FALLBACK_TITLE)).toBe("English only");
  });

  it("雙語物件：僅有 zh-TW 時回傳中文", () => {
    expect(resolveBreakingEventLocalizedText({ "zh-TW": "只有中文" }, FALLBACK_TITLE)).toBe("只有中文");
  });

  it("物件內為非字串欄位：略過並回傳 fallback", () => {
    expect(resolveBreakingEventLocalizedText({ en: 123, "zh-TW": null }, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
  });

  it("fallback 非字串：回傳空字串而不拋錯", () => {
    expect(resolveBreakingEventLocalizedText(null, undefined)).toBe("");
  });

  it("純字串：原樣（trim 後）回傳", () => {
    expect(resolveBreakingEventLocalizedText("  Raw title  ", FALLBACK_TITLE)).toBe("Raw title");
  });

  it("空值或格式錯誤：回傳 fallback、不拋錯", () => {
    expect(resolveBreakingEventLocalizedText(null, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText(undefined, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText("", FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText("   ", FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText(42, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText([], FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText({}, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
    expect(resolveBreakingEventLocalizedText({ en: "", "zh-TW": "" }, FALLBACK_TITLE)).toBe(FALLBACK_TITLE);
  });

  it("其他語系鍵：在 zh-TW / en 皆空時採用第一個非空字串", () => {
    expect(
      resolveBreakingEventLocalizedText({ en: "", "zh-TW": "", ja: "やあ" }, FALLBACK_TITLE)
    ).toBe("やあ");
  });
});
