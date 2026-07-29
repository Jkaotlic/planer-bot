import { describe, it, expect } from "vitest";
import { formatDayLabel, formatDayLabelRelative, isCurrentPeriod } from "./week";

describe("formatDayLabelRelative", () => {
  it("says «Сегодня» when the shown day is today", () => {
    expect(formatDayLabelRelative("2026-07-29", "2026-07-29")).toBe("Сегодня, Ср 29 июля");
  });

  it("reads exactly like the plain label on any other day", () => {
    expect(formatDayLabelRelative("2026-07-30", "2026-07-29")).toBe(formatDayLabel("2026-07-30"));
    expect(formatDayLabelRelative("2026-07-28", "2026-07-29")).toBe(formatDayLabel("2026-07-28"));
  });
});

describe("isCurrentPeriod", () => {
  it("in day mode, only the exact day counts as current", () => {
    expect(isCurrentPeriod("day", "2026-07-29", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("day", "2026-07-30", "2026-07-29")).toBe(false);
  });

  it("in week mode, any day of this week counts", () => {
    // 2026-07-29 is a Wednesday; its week runs Mon 27 — Sun 2 Aug.
    expect(isCurrentPeriod("week", "2026-07-27", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("week", "2026-08-02", "2026-07-29")).toBe(true);
    expect(isCurrentPeriod("week", "2026-08-03", "2026-07-29")).toBe(false);
    expect(isCurrentPeriod("week", "2026-07-26", "2026-07-29")).toBe(false);
  });
});
