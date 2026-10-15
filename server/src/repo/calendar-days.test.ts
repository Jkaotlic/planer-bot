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
  it("null убирает ручную строку на обычном дне", () => {
    const db = makeTestDb();
    // Обычная дата: 31.12.2026 в зашитом календаре — праздник, и снятие вернуло бы его.
    setManualDay(db, "2026-10-14", "holiday", null, NOW);
    setManualDay(db, "2026-10-14", null, null, NOW);
    expect(loadCalendar(db, "2026-10-14", "2026-10-14").size).toBe(0);
  });
  it("поверх авто-строки становится ручной", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", "workday", null, NOW);
    expect(listCalendarYear(db, 2026).find((d) => d.date === "2026-06-12")!.source).toBe("manual");
  });
});

// F2 (аудит 2026-10-15): снятие ручной отметки возвращает день к календарю,
// а не к пустоте до следующего обновления через 30 дней.
describe("setManualDay: авто-значение под ручной отметкой", () => {
  const row = (db: ReturnType<typeof makeTestDb>, date: string) =>
    listCalendarYear(db, Number(date.slice(0, 4))).find((d) => d.date === date);

  it("авто-праздник → «рабочий» вручную → снять → снова праздник с подписью", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", "workday", "работаем", NOW);
    // Прямо, а не только через снятие: на 2026 запасной зашитый календарь замаскировал бы потерю.
    expect(row(db, "2026-06-12")).toMatchObject({ kind: "workday", source: "manual", autoKind: "holiday", autoNote: "День России" });
    setManualDay(db, "2026-06-12", null, null, NOW);
    expect(row(db, "2026-06-12")).toMatchObject({ kind: "holiday", note: "День России", source: "auto" });
  });

  it("повторная ручная отметка поверх ручной не теряет авто-значение", () => {
    const db = makeTestDb();
    // 2027: зашитого календаря на год нет, и запасной источник не замаскирует потерю.
    replaceAutoYear(db, 2027, [{ date: "2027-06-14", kind: "holiday", note: "Перенос" }], NOW);
    setManualDay(db, "2027-06-14", "workday", null, NOW);
    setManualDay(db, "2027-06-14", "holiday", "сами решили", NOW);
    setManualDay(db, "2027-06-14", null, null, NOW);
    expect(row(db, "2027-06-14")).toMatchObject({ kind: "holiday", note: "Перенос", source: "auto" });
  });

  it("снятие на авто-строке ничего не стирает", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", null, null, NOW);
    expect(row(db, "2026-06-12")).toMatchObject({ kind: "holiday", source: "auto" });
  });

  it("обновление года переписывает авто-значение под ручной строкой", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2026, RU2026, NOW);
    setManualDay(db, "2026-06-12", "workday", null, NOW);
    replaceAutoYear(db, 2026, [{ date: "2026-06-12", kind: "holiday", note: "День России (уточнено)" }], NOW);
    expect(row(db, "2026-06-12")).toMatchObject({ kind: "workday", source: "manual", autoKind: "holiday", autoNote: "День России (уточнено)" });
    setManualDay(db, "2026-06-12", null, null, NOW);
    expect(row(db, "2026-06-12")).toMatchObject({ kind: "holiday", note: "День России (уточнено)", source: "auto" });
  });

  it("если в новом наборе даты нет — авто-значение обнуляется, и снятие отметки удаляет строку", () => {
    const db = makeTestDb();
    replaceAutoYear(db, 2027, [{ date: "2027-06-12", kind: "holiday", note: "День России" }], NOW);
    setManualDay(db, "2027-06-12", "workday", null, NOW);
    replaceAutoYear(db, 2027, [], NOW);
    expect(row(db, "2027-06-12")).toMatchObject({ source: "manual", autoKind: null, autoNote: null });
    setManualDay(db, "2027-06-12", null, null, NOW);
    expect(row(db, "2027-06-12")).toBeUndefined();
  });

  it("старая ручная строка без авто-значения (до миграции 0044) берёт его из зашитого календаря", () => {
    const db = makeTestDb();
    // Так выглядит строка, поставленная руками до миграции: auto_* пусты,
    // хотя под ней был праздник.
    setManualDay(db, "2026-11-04", "workday", null, NOW);
    expect(row(db, "2026-11-04")).toMatchObject({ autoKind: null });
    setManualDay(db, "2026-11-04", null, null, NOW);
    expect(row(db, "2026-11-04")).toMatchObject({ kind: "holiday", note: "День народного единства", source: "auto" });
  });

  it("запасной источник не выдумывает: обычный день и сокращённый уходят без строки", () => {
    const db = makeTestDb();
    setManualDay(db, "2026-10-14", "holiday", null, NOW);
    setManualDay(db, "2026-11-03", "holiday", null, NOW); // в зашитом — `short`, в таблицу не едет
    setManualDay(db, "2026-10-14", null, null, NOW);
    setManualDay(db, "2026-11-03", null, null, NOW);
    expect(row(db, "2026-10-14")).toBeUndefined();
    expect(row(db, "2026-11-03")).toBeUndefined();
  });
});
