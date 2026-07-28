import { describe, expect, it } from "vitest";
import {
  SCHEDULE_ACCENT_PALETTES,
  VACATION_SCHEDULE_PALETTE,
  exactSchedulePalette,
} from "./schedule-palette";

describe("working schedule palette", () => {
  it("matches every sampled colour and visible code", () => {
    expect(SCHEDULE_ACCENT_PALETTES).toEqual({
      blue: { bg: "#EAF0F0", fg: "#17202A", code: "Д" },
      gold: { bg: "#FEFF01", fg: "#17202A", code: "У" },
      violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
      indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
      rose: { bg: "#F2B07E", fg: "#17202A", code: "Т" },
      green: { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
      teal: { bg: "#FE87FF", fg: "#39133A", code: "П" },
      amber: { bg: "#CBC04D", fg: "#292505", code: "07" },
    });
    expect(VACATION_SCHEDULE_PALETTE).toEqual({
      bg: "#FD0100",
      fg: "#FFFFFF",
      code: "О",
    });
  });

  it("gives every kind its own letter", () => {
    // Two kinds sharing a letter would be invisible: the week grid would draw the
    // same code for both, and the legend keys on it, so one line would silently
    // stand for two different squares.
    const codes = [
      ...Object.values(SCHEDULE_ACCENT_PALETTES).map((p) => p.code),
      VACATION_SCHEDULE_PALETTE.code,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never uses the dot the grid reserves for a preset-less entry", () => {
    const codes = Object.values(SCHEDULE_ACCENT_PALETTES).map((p) => p.code);
    expect(codes).not.toContain("•");
    expect(VACATION_SCHEDULE_PALETTE.code).not.toBe("•");
  });

  it("leaves unspecified categories to the existing theme palette", () => {
    expect(exactSchedulePalette(undefined, "sick_leave")).toBeNull();
    expect(exactSchedulePalette(undefined, "business_trip")).toBeNull();
    expect(exactSchedulePalette(undefined, "offsite")).toBeNull();
    expect(exactSchedulePalette(undefined, "weekend_work")).toBeNull();
  });
});
