import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { listCalendarYear, setManualDay } from "../repo/calendar-days";
import { holidaysState, setHolidayYearState, setHolidaysAuto } from "../repo/settings";
import { listRecentAudit } from "../repo/audit";
import { refreshHolidays, runHolidayTick } from "./holiday-tick";
import type { FetchOutcome, FetchYear } from "./xmlcalendar";

const XML = (year: number) =>
  `<calendar year="${year}"><holidays><holiday id="7" title="День России"/></holidays><days><day d="06.12" t="1" h="7"/></days></calendar>`;
const NOW = { date: "2026-09-04" };

/** Загрузчик-заглушка: помнит, какие годы у него спрашивали. */
function fetcher(map: Record<number, FetchOutcome>): FetchYear & { calls: number[] } {
  const calls: number[] = [];
  const fn = (async (year: number) => {
    calls.push(year);
    return map[year] ?? { status: "missing" };
  }) as FetchYear & { calls: number[] };
  fn.calls = calls;
  return fn;
}

describe("runHolidayTick", () => {
  it("тянет текущий и следующий год; следующий ещё не опубликован — молчит", async () => {
    const db = makeTestDb();
    const fetchYear = fetcher({ 2026: { status: "ok", xml: XML(2026) } });

    expect(await runHolidayTick(db, fetchYear, NOW)).toBe(1);

    expect(fetchYear.calls).toEqual([2026, 2027]);
    expect(listCalendarYear(db, 2026).map((d) => d.date)).toEqual(["2026-06-12"]);
    expect(listCalendarYear(db, 2027)).toHaveLength(0);
    expect(holidaysState(db)["2026"]).toMatchObject({ source: "xmlcalendar", days: 1 });
    expect(listRecentAudit(db, 5)[0]).toMatchObject({ type: "holidays_refreshed" });
  });

  it("второй тик того же дня в сеть не ходит", async () => {
    const db = makeTestDb();
    const fetchYear = fetcher({ 2026: { status: "ok", xml: XML(2026) } });

    await runHolidayTick(db, fetchYear, NOW);
    await runHolidayTick(db, fetchYear, NOW);

    expect(fetchYear.calls).toEqual([2026, 2027]);
  });

  it("свежие данные не перечитываются, залежавшиеся — перечитываются", async () => {
    const db = makeTestDb();
    const fetchYear = fetcher({ 2026: { status: "ok", xml: XML(2026) } });

    await runHolidayTick(db, fetchYear, NOW);
    await runHolidayTick(db, fetchYear, { date: "2026-09-05" });
    expect(fetchYear.calls.filter((y) => y === 2026)).toHaveLength(1);

    setHolidayYearState(db, 2026, { ...holidaysState(db)["2026"]!, refreshedAt: "2026-07-01T00:00:00.000Z" });
    await runHolidayTick(db, fetchYear, { date: "2026-09-06" });
    expect(fetchYear.calls.filter((y) => y === 2026)).toHaveLength(2);
  });

  it("рычаг выключен — ни сети, ни строк", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });
    setHolidaysAuto(db, false, admin.id);
    const fetchYear = fetcher({ 2026: { status: "ok", xml: XML(2026) } });

    expect(await runHolidayTick(db, fetchYear, NOW)).toBe(0);

    expect(fetchYear.calls).toEqual([]);
    expect(listCalendarYear(db, 2026)).toHaveLength(0);
  });

  it("сеть упала, год пуст — берётся зашитая копия", async () => {
    const db = makeTestDb();

    await runHolidayTick(db, fetcher({ 2026: { status: "error", message: "fetch failed" } }), NOW);

    expect(listCalendarYear(db, 2026).length).toBeGreaterThan(10);
    expect(holidaysState(db)["2026"]!.source).toBe("bundled");
  });

  it("сеть упала, год уже есть — данные не трогаются", async () => {
    const db = makeTestDb();
    await runHolidayTick(db, fetcher({ 2026: { status: "ok", xml: XML(2026) } }), NOW);
    setHolidayYearState(db, 2026, { ...holidaysState(db)["2026"]!, refreshedAt: "2026-07-01T00:00:00.000Z" });

    await runHolidayTick(db, fetcher({ 2026: { status: "error", message: "boom" } }), { date: "2026-09-05" });

    expect(listCalendarYear(db, 2026)).toHaveLength(1);
    expect(holidaysState(db)["2026"]!.source).toBe("xmlcalendar");
  });

  it("ручная отметка переживает обновление", async () => {
    const db = makeTestDb();
    setManualDay(db, "2026-06-12", "workday", "работаем", new Date());

    await runHolidayTick(db, fetcher({ 2026: { status: "ok", xml: XML(2026) } }), NOW);

    expect(listCalendarYear(db, 2026)[0]).toMatchObject({ kind: "workday", source: "manual" });
  });

  it("календарь чужого года не пишется под запрошенный", async () => {
    const db = makeTestDb();
    // На 2027-й источник отдаёт документ 2026-го — кэш или редирект.
    await runHolidayTick(db, fetcher({ 2026: { status: "ok", xml: XML(2026) }, 2027: { status: "ok", xml: XML(2026) } }), NOW);

    expect(listCalendarYear(db, 2027)).toHaveLength(0);
    expect(listCalendarYear(db, 2026).map((d) => d.date)).toEqual(["2026-06-12"]);
  });

  it("битый ответ с кодом 200 год не стирает", async () => {
    const db = makeTestDb();
    await runHolidayTick(db, fetcher({ 2026: { status: "ok", xml: XML(2026) } }), NOW);
    setHolidayYearState(db, 2026, { ...holidaysState(db)["2026"]!, refreshedAt: "2026-07-01T00:00:00.000Z" });

    await runHolidayTick(db, fetcher({ 2026: { status: "ok", xml: "<html>502</html>" } }), { date: "2026-09-05" });

    expect(listCalendarYear(db, 2026)).toHaveLength(1);
  });
});

describe("refreshHolidays — кнопка «Обновить сейчас»", () => {
  it("отчитывается по каждому году и пишет провал в журнал", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-a" });

    const report = await refreshHolidays(
      db,
      fetcher({ 2026: { status: "error", message: "HTTP 500" } }),
      [2026, 2027],
      admin.id,
      new Date("2026-09-04T10:00:00Z"),
    );

    expect(report.map((r) => [r.year, r.status])).toEqual([
      [2026, "bundled"],
      [2027, "missing"],
    ]);
    expect(listRecentAudit(db, 5).some((e) => e.type === "holidays_refresh_failed")).toBe(true);
  });
});
