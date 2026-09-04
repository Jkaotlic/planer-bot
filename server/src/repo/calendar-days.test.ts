import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { listCalendarYear, loadCalendar, replaceAutoYear, setManualDay } from "./calendar-days";

const NOW = new Date("2026-09-04T10:00:00Z");
const RU2026 = [
  { date: "2026-01-01", kind: "holiday" as const, note: "Новогодние каникулы" },
  { date: "2026-06-12", kind: "holiday" as const, note: "День России" },
];

describe("replaceAutoYear", () => {
  it("кладёт год и отдаёт счёт", () => {
    const db = makeTestDb();
    expect(replaceAutoYear(db, 2026, RU2026, NOW)).toEqual({ added: 2, removed: 0 });
    expect(loadCalendar(db, "2026-06-01", "2026-06-30").get("2026-06-12")).toBe("holiday");
  });

  it("переписывает только свои строки: ручная переживает обновление", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", "workday", "работаем", NOW);
    setManualDay(db, "2026-12-31", "holiday", null, NOW);
    const report = replaceAutoYear(db, 2026, RU2026, NOW);
    // Одна авто-строка (01.01) снята и поставлена заново; 12.06 занят ручной и не вставлен.
    expect(report).toEqual({ added: 1, removed: 1 });
    const cal = loadCalendar(db, "2026-01-01", "2026-12-31");
    expect(cal.get("2026-06-12")).toBe("workday");
    expect(cal.get("2026-12-31")).toBe("holiday");
    expect(cal.get("2026-01-01")).toBe("holiday");
  });

  it("не трогает соседний год", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    replaceAutoYear(db, 2027, [{ date: "2027-01-01", kind: "holiday", note: null }], NOW);
    expect(listCalendarYear(db, 2026)).toHaveLength(2);
  });
});

describe("setManualDay", () => {
  it("null убирает ручную строку", () => {
    const db = makeTestDb();
    setManualDay(db, "2026-12-31", "holiday", null, NOW);
    setManualDay(db, "2026-12-31", null, null, NOW);
    expect(loadCalendar(db, "2026-12-31", "2026-12-31").size).toBe(0);
  });
  it("поверх авто-строки становится ручной", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", "workday", null, NOW);
    expect(listCalendarYear(db, 2026).find((d) => d.date === "2026-06-12")!.source).toBe("manual");
  });
});
