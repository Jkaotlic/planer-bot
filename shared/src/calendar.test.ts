import { describe, it, expect } from "vitest";
import { EMPTY_CALENDAR, calendarFrom, dayOffLabel, isDayOff, specialDays } from "./calendar";

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
  it("рабочий день в будни — «Рабочий день», а не «рабочая суббота»", () => {
    expect(dayOffLabel("2026-02-23", "workday", null)).toBe("💼 Рабочий день");
  });
  it("обычный день — ничего", () => {
    expect(dayOffLabel("2026-06-13", undefined, null)).toBeNull();
  });
});

describe("specialDays — подписи праздников и рабочих выходных недели", () => {
  const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  it("обычная неделя — пусто", () => {
    expect(specialDays(WEEK, [])).toEqual([]);
  });
  it("праздник с названием и рабочая суббота, по порядку дат", () => {
    const rows = [
      { date: "2026-11-07", kind: "workday" as const, note: null },
      { date: "2026-11-04", kind: "holiday" as const, note: "День народного единства" },
    ];
    expect(specialDays(WEEK, rows).map((d) => d.label)).toEqual([
      "🎉 Ср 4 — День народного единства",
      "💼 Сб 7 — рабочая суббота",
    ]);
    expect(specialDays(WEEK, rows).map((d) => d.short)).toEqual(["🎉 День народного единства", "💼 рабочая"]);
  });
  it("праздник без названия — «выходной по календарю»", () => {
    const [day] = specialDays(WEEK, [{ date: "2026-11-04", kind: "holiday", note: null }]);
    expect(day!.label).toBe("🎉 Ср 4 — выходной по календарю");
    expect(day!.short).toBe("🎉 выходной");
  });
  it("рабочее воскресенье называется по дню недели", () => {
    const [day] = specialDays(WEEK, [{ date: "2026-11-08", kind: "workday" }]);
    expect(day!.label).toBe("💼 Вс 8 — рабочее воскресенье");
  });
  it("рабочий день в будни — не особый: ни «рабочей субботы», ни строки вовсе", () => {
    // 2026-11-04 — среда, возвращённая в работу вручную; читателю это обычный день.
    expect(specialDays(WEEK, [{ date: "2026-11-04", kind: "workday" }])).toEqual([]);
  });
  it("порядок — по списку дат, а не по порядку строк; дни вне списка не попадают", () => {
    const rows = [
      { date: "2026-12-31", kind: "holiday" as const, note: null },
      { date: "2026-11-05", kind: "holiday" as const, note: "Б" },
      { date: "2026-11-03", kind: "holiday" as const, note: "А" },
    ];
    expect(specialDays(WEEK, rows).map((d) => d.date)).toEqual(["2026-11-03", "2026-11-05"]);
  });
});
