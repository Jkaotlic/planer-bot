import { describe, it, expect } from "vitest";
import { dayOptions, formatDayLabel, formatDayLabelRelative, isCurrentPeriod } from "./week";

const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

describe("dayOptions", () => {
  it("leaves the week alone when the entry's date is inside it", () => {
    expect(dayOptions(WEEK, "2026-06-10")).toEqual(WEEK);
  });

  it("carries in an end date that runs past the shown week, in order", () => {
    // Отпуска приходят из импорта прогонами по две недели. Без этого у селекта
    // нет выбранного варианта, браузер рисует первый — и экран сообщает, что
    // отпуск кончается в понедельник показанной недели.
    expect(dayOptions(WEEK, "2026-06-22")).toEqual([...WEEK, "2026-06-22"]);
  });

  it("carries in a start date from before the shown week, in order", () => {
    expect(dayOptions(WEEK, "2026-06-01")).toEqual(["2026-06-01", ...WEEK]);
  });
});

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
