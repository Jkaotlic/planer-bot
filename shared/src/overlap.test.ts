import { describe, it, expect } from "vitest";
import { shiftsOverlap } from "./overlap";

const s = (date: string, start: string, end: string) => ({ date, start, end });

describe("shiftsOverlap", () => {
  it("is false for shifts on different days", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-06", "09:00", "17:00"))).toBe(false);
  });

  it("is true for same-day overlapping shifts", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-05", "16:00", "20:00"))).toBe(true);
  });

  it("is false for adjacent (touching) shifts", () => {
    expect(shiftsOverlap(s("2026-07-05", "09:00", "17:00"), s("2026-07-05", "17:00", "23:00"))).toBe(false);
  });

  it("detects an overnight shift bleeding into the next day", () => {
    expect(shiftsOverlap(s("2026-07-05", "23:00", "07:00"), s("2026-07-06", "06:00", "14:00"))).toBe(true);
  });
});
