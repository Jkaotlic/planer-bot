import { describe, expect, it } from "vitest";
import { groupUpcomingByWeek, remainingThisWeek } from "./upcoming";
import type { Shift } from "../api/client";

/** Минимальная запись: тестам важны только дата, категория и время. */
let nextId = 1;
function entry(over: Partial<Shift> & { date: string }): Shift {
  return {
    id: nextId++, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title: "День", location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 7,
    ...over,
  } as Shift;
}

// Среда 5 августа 2026. Понедельник её недели — 3 августа, воскресенье — 9-е.
const WEDNESDAY = "2026-08-05";

describe("groupUpcomingByWeek", () => {
  it("кладёт текущую неделю первой и называет её от сегодня, а не от понедельника", () => {
    const weeks = groupUpcomingByWeek([entry({ date: "2026-08-06" })], WEDNESDAY);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.label).toBe("Эта неделя · 5–9 августа");
  });

  it("называет вторую неделю следующей, а дальние — просто диапазоном", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-06" }), entry({ date: "2026-08-11" }), entry({ date: "2026-08-25" })],
      WEDNESDAY,
    );
    expect(weeks.map((w) => w.label)).toEqual([
      "Эта неделя · 5–9 августа",
      "Следующая неделя · 10–16 августа",
      "24–30 августа",
    ]);
  });

  it("не выдумывает пустых недель между занятыми", () => {
    const weeks = groupUpcomingByWeek([entry({ date: "2026-08-06" }), entry({ date: "2026-08-25" })], WEDNESDAY);
    expect(weeks).toHaveLength(2);
  });

  it("в воскресенье текущая неделя — один день", () => {
    const sunday = "2026-08-09";
    const weeks = groupUpcomingByWeek([entry({ date: sunday })], sunday);
    expect(weeks[0]!.label).toBe("Эта неделя · 9 августа");
  });

  it("на пустом входе возвращает пусто, а не неделю без смен", () => {
    expect(groupUpcomingByWeek([], WEDNESDAY)).toEqual([]);
  });

  it("многодневную запись, которая ещё не началась, кладёт в неделю её начала, а не в обе", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-06", endDate: "2026-08-14", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.label).toBe("Эта неделя · 5–9 августа");
  });

  it("многодневную запись, начавшуюся раньше и идущую прямо сейчас, кладёт в текущую неделю, а не в прошедшую", () => {
    // Отпуск начался в субботу прошлой недели (1 августа) и тянется до 20-го —
    // сервер отдаёт его, потому что он ещё не кончился (Task 1: окно режет по
    // концу записи). Неделя его начала (27 июля – 2 августа) уже прошла целиком:
    // попади запись туда, «Мои смены» показали бы отпуск в разделе,
    // помеченном как прошедший, выше «Эта неделя».
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-01", endDate: "2026-08-20", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.label).toBe("Эта неделя · 5–9 августа");
  });

  it("запись, уже завершившуюся до сегодня, не показывает вовсе", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-07-20", endDate: "2026-08-01", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(weeks).toEqual([]);
  });

  it("держит смены внутри недели в порядке дат", () => {
    const weeks = groupUpcomingByWeek(
      [entry({ date: "2026-08-08" }), entry({ date: "2026-08-06" })],
      WEDNESDAY,
    );
    expect(weeks[0]!.shifts.map((s) => s.date)).toEqual(["2026-08-06", "2026-08-08"]);
  });
});

describe("remainingThisWeek", () => {
  it("считает только остаток текущей недели", () => {
    const res = remainingThisWeek(
      [entry({ date: "2026-08-06" }), entry({ date: "2026-08-11" })],
      WEDNESDAY,
    );
    expect(res).toEqual({ count: 1, hours: 9 });
  });

  it("отпуск не добавляет ни смен, ни часов", () => {
    const res = remainingThisWeek(
      [entry({ date: "2026-08-06", category: "vacation", start: null, end: null, title: null })],
      WEDNESDAY,
    );
    expect(res).toEqual({ count: 0, hours: 0 });
  });

  it("на пустой неделе даёт нули, а не NaN", () => {
    expect(remainingThisWeek([], WEDNESDAY)).toEqual({ count: 0, hours: 0 });
  });
});
