import { describe, it, expect } from "vitest";
import {
  toMinutes, dayOfWeek, resolveShiftTimes, shiftDurationHours, isNightShift, isWeekend, nextDate,
} from "./time";
import type { ShiftTemplate } from "./types";

const evening: ShiftTemplate = {
  id: 3, name: "Вечер", start: "11:00", end: "20:00",
  fridayStart: "12:00", fridayEnd: "20:00",
  isLate: true, sendReminder: false, sortOrder: 2, isActive: true,
};

describe("time", () => {
  it("converts HH:MM to minutes", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("15:45")).toBe(945);
  });

  it("computes day of week (2026-07-05 is Sunday)", () => {
    expect(dayOfWeek("2026-07-05")).toBe(0); // Sunday
    expect(dayOfWeek("2026-07-03")).toBe(5); // Friday
  });

  it("uses the friday override on fridays only", () => {
    expect(resolveShiftTimes(evening, "2026-07-03")).toEqual({ start: "12:00", end: "20:00" }); // Fri
    expect(resolveShiftTimes(evening, "2026-07-02")).toEqual({ start: "11:00", end: "20:00" }); // Thu
  });

  it("computes duration, handling overnight", () => {
    expect(shiftDurationHours({ start: "15:00", end: "23:00" })).toBe(8);
    expect(shiftDurationHours({ start: "23:00", end: "07:00" })).toBe(8); // overnight
  });

  it("detects night shifts (end >= 22:00 or overnight)", () => {
    expect(isNightShift({ start: "15:00", end: "23:00" })).toBe(true);
    expect(isNightShift({ start: "11:00", end: "20:00" })).toBe(false); // evening, not night
    expect(isNightShift({ start: "23:00", end: "07:00" })).toBe(true);
  });

  it("detects weekends", () => {
    expect(isWeekend("2026-07-05")).toBe(true);  // Sun
    expect(isWeekend("2026-07-04")).toBe(true);  // Sat
    expect(isWeekend("2026-07-03")).toBe(false); // Fri
  });

  it("computes the next calendar day", () => {
    expect(nextDate("2026-07-31")).toBe("2026-08-01"); // month rollover
    expect(nextDate("2026-12-31")).toBe("2027-01-01"); // year rollover
    expect(nextDate("2026-07-14")).toBe("2026-07-15");
  });
});
