import { describe, it, expect } from "vitest";
import { reminderKind, isReminderWorthy, wakeTime, buildReminderText } from "./reminder";

describe("reminderKind", () => {
  it("morning: starts before 09:00 (not night)", () => {
    expect(reminderKind({ start: "08:00", end: "17:00" })).toBe("morning");
    expect(reminderKind({ start: "07:00", end: "16:00" })).toBe("morning");
  });

  it("the standard 09:00–18:00 is a day shift, not a morning one", () => {
    // The boundary is exclusive: «День» starts at exactly 09:00, and calling it
    // «утренняя» in a reminder was both noise and the wrong word.
    expect(reminderKind({ start: "09:00", end: "18:00" })).toBe("day");
    expect(reminderKind({ start: "08:59", end: "18:00" })).toBe("morning");
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
  it("reminds about the three shifts that change your evening", () => {
    expect(isReminderWorthy({ start: "08:00", end: "17:00" }), "утро").toBe(true);
    expect(isReminderWorthy({ start: "11:00", end: "20:00" }), "вечер").toBe(true);
    expect(isReminderWorthy({ start: "15:00", end: "23:00" }), "ночь").toBe(true);
    expect(isReminderWorthy({ start: "23:00", end: "07:00" }), "ночь через полночь").toBe(true);
  });

  it("stays silent about the plain day shift", () => {
    // 09:00–18:00 is what everybody expects by default. A nightly message about
    // it is the fastest way to teach people to ignore the ones that matter.
    expect(isReminderWorthy({ start: "10:00", end: "18:00" })).toBe(false);
    expect(isReminderWorthy({ start: "09:30", end: "18:30" })).toBe(false);
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
