import { describe, expect, it } from "vitest";
import { sickExtensionRuns, sickSpanIntersection, sickSpanShort, sickSpanWords } from "./sick-approval";

describe("слова про срок больничного", () => {
  it("в письме работнику — полными словами, месяц один раз", () => {
    expect(sickSpanWords("2026-10-06", "2026-10-08")).toBe("с 6 по 8 октября");
    expect(sickSpanWords("2026-09-30", "2026-10-02")).toBe("с 30 сентября по 2 октября");
    expect(sickSpanWords("2026-10-06", null)).toBe("на 6 октября");
    expect(sickSpanWords("2026-10-06", "2026-10-06")).toBe("на 6 октября");
  });

  it("в письме админам — коротко", () => {
    expect(sickSpanShort("2026-10-06", "2026-10-08")).toBe("6–8 окт.");
    expect(sickSpanShort("2026-09-30", "2026-10-02")).toBe("30 сент. – 2 окт.");
    expect(sickSpanShort("2026-10-06", null)).toBe("6 окт.");
  });
});

describe("дни продления больничного", () => {
  it("only the days outside the approved span, as contiguous runs", () => {
    // Wrong implementation caught: returning the whole new span (the letter would
    // ask about days an admin already approved).
    expect(sickExtensionRuns({ date: "2026-10-06", endDate: "2026-10-07" }, { date: "2026-10-06", endDate: "2026-10-09" })).toEqual([
      { date: "2026-10-08", endDate: "2026-10-09" },
    ]);
  });

  it("a single new day has no end; both sides give two runs", () => {
    // Wrong implementation caught: merging the two sides into one run across the approved days.
    expect(sickExtensionRuns({ date: "2026-10-07", endDate: null }, { date: "2026-10-06", endDate: "2026-10-08" })).toEqual([
      { date: "2026-10-06", endDate: null },
      { date: "2026-10-08", endDate: null },
    ]);
  });

  it("nothing new when the span only shrank", () => {
    expect(sickExtensionRuns({ date: "2026-10-06", endDate: "2026-10-08" }, { date: "2026-10-06", endDate: null })).toEqual([]);
  });
});

describe("общие дни двух сроков", () => {
  it("overlap, single day, and none", () => {
    // Wrong implementation caught: taking the union or the first span.
    expect(sickSpanIntersection({ date: "2026-10-06", endDate: "2026-10-08" }, { date: "2026-10-07", endDate: "2026-10-10" })).toEqual({ date: "2026-10-07", endDate: "2026-10-08" });
    expect(sickSpanIntersection({ date: "2026-10-06", endDate: "2026-10-08" }, { date: "2026-10-08", endDate: null })).toEqual({ date: "2026-10-08", endDate: null });
    expect(sickSpanIntersection({ date: "2026-10-06", endDate: null }, { date: "2026-10-08", endDate: "2026-10-09" })).toBeNull();
  });
});
