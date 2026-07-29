import { describe, it, expect } from "vitest";
import { formatDayLabel, formatDayLabelRelative } from "./week";

describe("formatDayLabelRelative", () => {
  it("says «Сегодня» when the shown day is today", () => {
    expect(formatDayLabelRelative("2026-07-29", "2026-07-29")).toBe("Сегодня, Ср 29 июля");
  });

  it("reads exactly like the plain label on any other day", () => {
    expect(formatDayLabelRelative("2026-07-30", "2026-07-29")).toBe(formatDayLabel("2026-07-30"));
    expect(formatDayLabelRelative("2026-07-28", "2026-07-29")).toBe(formatDayLabel("2026-07-28"));
  });
});
