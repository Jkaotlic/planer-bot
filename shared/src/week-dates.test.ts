import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  formatWeekRangeLabelIso,
  mondayOfIso,
  weekdayShort,
  eachDayIso,
} from "./week-dates";

describe("календарь недели", () => {
  it("mondayOfIso даёт понедельник той же недели", () => {
    expect(mondayOfIso("2026-08-06")).toBe("2026-08-03"); // четверг
    expect(mondayOfIso("2026-08-03")).toBe("2026-08-03"); // сам понедельник
    // Воскресенье — последний день той же недели, а не первый день следующей.
    expect(mondayOfIso("2026-08-09")).toBe("2026-08-03");
  });

  it("addDaysIso переходит через границу месяца и считает назад", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-08-03", -7)).toBe("2026-07-27");
    expect(addDaysIso("2026-08-03", 6)).toBe("2026-08-09");
  });

  it("weekdayShort нумерует с понедельника", () => {
    expect(weekdayShort("2026-08-03")).toBe("Пн");
    expect(weekdayShort("2026-08-09")).toBe("Вс");
  });

  it("formatWeekRangeLabelIso называет месяц словом", () => {
    // Точное тире зависит от версии ICU, поэтому проверяем смысл, а не байты.
    const label = formatWeekRangeLabelIso("2026-08-03", "2026-08-09");
    expect(label).toContain("3");
    expect(label).toContain("9");
    expect(label).toContain("август");
  });
});

describe("eachDayIso", () => {
  it("однодневный диапазон — один день", () => {
    expect(eachDayIso("2026-08-12", "2026-08-12")).toEqual(["2026-08-12"]);
  });

  it("трёхдневный — три дня по порядку", () => {
    expect(eachDayIso("2026-08-12", "2026-08-14")).toEqual(["2026-08-12", "2026-08-13", "2026-08-14"]);
  });

  it("через границу месяца считает по календарю, а не по числу", () => {
    expect(eachDayIso("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  /** Перевёрнутый диапазон обязан кончиться пустым списком, а не крутиться вечно. */
  it("конец раньше начала — пусто", () => {
    expect(eachDayIso("2026-08-14", "2026-08-12")).toEqual([]);
  });
});
