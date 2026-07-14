import { describe, it, expect } from "vitest";
import { reminderKind, isReminderWorthy, wakeTime, buildReminderText } from "./reminder";

describe("reminderKind", () => {
  it("morning: starts at/before 09:00 (not night)", () => {
    expect(reminderKind({ start: "08:00", end: "17:00" })).toBe("morning");
  });
  it("night: ends >= 22:00 (isNightShift)", () => {
    expect(reminderKind({ start: "15:00", end: "23:00" })).toBe("night");
  });
  it("night: overnight shift", () => {
    expect(reminderKind({ start: "23:00", end: "07:00" })).toBe("night");
  });
  it("evening: ends at/after 20:00, not night, not morning", () => {
    expect(reminderKind({ start: "11:00", end: "20:00" })).toBe("evening");
  });
  it("day: otherwise", () => {
    expect(reminderKind({ start: "10:00", end: "18:00" })).toBe("day");
  });
});

describe("isReminderWorthy", () => {
  it("morning and night are worthy", () => {
    expect(isReminderWorthy({ start: "08:00", end: "17:00" })).toBe(true);
    expect(isReminderWorthy({ start: "15:00", end: "23:00" })).toBe(true);
  });
  it("day and evening are not worthy", () => {
    expect(isReminderWorthy({ start: "10:00", end: "18:00" })).toBe(false);
    expect(isReminderWorthy({ start: "11:00", end: "20:00" })).toBe(false);
  });
});

describe("wakeTime", () => {
  it("subtracts the prep buffer from the start time", () => {
    expect(wakeTime("08:00", 60)).toBe("07:00");
  });
  it("clamps at 00:00 (never goes negative)", () => {
    expect(wakeTime("00:30", 60)).toBe("00:00");
  });
});

describe("buildReminderText", () => {
  it("morning message contains the wake time and mentions the alarm", () => {
    const text = buildReminderText({ name: "Аня", kind: "morning", timeRange: "08:00–17:00", wake: "07:00" });
    expect(text).toContain("07:00");
    expect(text).toContain("будильник");
  });
  it("night message mentions resting during the day", () => {
    const text = buildReminderText({ name: "Игорь", kind: "night", timeRange: "23:00–07:00" });
    expect(text).toContain("Отдохни днём");
  });
});
