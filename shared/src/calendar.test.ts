import { describe, it, expect } from "vitest";
import { EMPTY_CALENDAR, calendarFrom, dayOffLabel, isDayOff } from "./calendar";

// 2026-06-12 — пятница, День России; 2026-06-13 — суббота; 2024-04-27 — рабочая суббота.
const CAL = calendarFrom([
  { date: "2026-06-12", kind: "holiday" },
  { date: "2024-04-27", kind: "workday" },
]);

describe("isDayOff", () => {
  it("без календаря — суббота и воскресенье", () => {
    expect(isDayOff("2026-06-13", EMPTY_CALENDAR)).toBe(true);
    expect(isDayOff("2026-06-12", EMPTY_CALENDAR)).toBe(false);
  });
  it("праздник в будни — выходной", () => {
    expect(isDayOff("2026-06-12", CAL)).toBe(true);
  });
  it("рабочая суббота — будень", () => {
    expect(isDayOff("2024-04-27", CAL)).toBe(false);
  });
  it("обычная суббота при непустом календаре остаётся выходным", () => {
    expect(isDayOff("2026-06-13", CAL)).toBe(true);
  });
});

describe("dayOffLabel", () => {
  it("праздник с названием", () => {
    expect(dayOffLabel("2026-06-12", "holiday", "День России")).toBe("🎉 День России — выходной");
  });
  it("перенесённый выходной без названия", () => {
    expect(dayOffLabel("2026-01-09", "holiday", null)).toBe("🎉 Выходной по календарю");
  });
  it("рабочая суббота и рабочее воскресенье", () => {
    expect(dayOffLabel("2024-04-27", "workday", null)).toBe("💼 Рабочая суббота");
    expect(dayOffLabel("2024-04-28", "workday", null)).toBe("💼 Рабочее воскресенье");
  });
  it("обычный день — ничего", () => {
    expect(dayOffLabel("2026-06-13", undefined, null)).toBeNull();
  });
});
