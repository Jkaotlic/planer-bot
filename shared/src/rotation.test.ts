import { describe, it, expect } from "vitest";
import { rotationQueue, describeTurn, type RotationCandidate } from "./rotation";

const person = (
  employeeId: number,
  displayName: string,
  lastHeld: string | null,
  rosterOrder: number | null = employeeId,
): RotationCandidate => ({ employeeId, displayName, rosterOrder, lastHeld });

const ASOF = "2026-08-03";
const names = (queue: { displayName: string }[]) => queue.map((t) => t.displayName);

describe("rotationQueue", () => {
  it("puts whoever went longest without it first", () => {
    const queue = rotationQueue(
      [person(1, "Свежий", "2026-08-01"), person(2, "Давний", "2026-06-15"), person(3, "Средний", "2026-07-20")],
      ASOF,
    );
    expect(names(queue)).toEqual(["Давний", "Средний", "Свежий"]);
  });

  it("puts somebody who has never held it ahead of everyone", () => {
    const queue = rotationQueue(
      [person(1, "Давний", "2026-01-01"), person(2, "Новичок", null)],
      ASOF,
    );
    expect(names(queue)).toEqual(["Новичок", "Давний"]);
  });

  it("breaks a tie by the admin's list order, not by id", () => {
    const queue = rotationQueue(
      [person(9, "Девятый", "2026-07-01", 2), person(3, "Третий", "2026-07-01", 1)],
      ASOF,
    );
    expect(names(queue)).toEqual(["Третий", "Девятый"]);
  });

  it("orders several newcomers among themselves by list order too", () => {
    const queue = rotationQueue(
      [person(5, "Пятый", null, 3), person(2, "Второй", null, 1), person(8, "Восьмой", null, 2)],
      ASOF,
    );
    expect(names(queue)).toEqual(["Второй", "Восьмой", "Пятый"]);
  });

  it("counts the gap in whole days", () => {
    const [first] = rotationQueue([person(1, "Кто-то", "2026-07-20")], ASOF);
    expect(first!.daysSince).toBe(14);
  });

  it("reports null rather than a number for somebody who never held it", () => {
    const [first] = rotationQueue([person(1, "Новичок", null)], ASOF);
    expect(first!.daysSince).toBeNull();
  });

  it("does not touch the array it was given", () => {
    const input = [person(1, "А", "2026-08-01"), person(2, "Б", "2026-06-01")];
    rotationQueue(input, ASOF);
    expect(names(input)).toEqual(["А", "Б"]);
  });

  it("returns an empty queue for an empty pool", () => {
    expect(rotationQueue([], ASOF)).toEqual([]);
  });
});

describe("describeTurn", () => {
  const turn = (daysSince: number | null) => ({
    employeeId: 1, displayName: "Лапин", rosterOrder: 0, lastHeld: daysSince === null ? null : "x", daysSince,
  });

  it("says plainly when somebody has never done it", () => {
    expect(describeTurn(turn(null), "week")).toBe("Лапин (ещё не дежурил)");
  });

  it("counts a weekly duty in weeks, because it is handed out a week at a time", () => {
    expect(describeTurn(turn(21), "week")).toBe("Лапин (3 недели назад)");
    expect(describeTurn(turn(7), "week")).toBe("Лапин (1 неделя назад)");
  });

  it("falls back to days when a weekly duty was less than a week ago", () => {
    expect(describeTurn(turn(3), "week")).toBe("Лапин (3 дня назад)");
  });

  it("counts a daily duty in days", () => {
    expect(describeTurn(turn(21), "day")).toBe("Лапин (21 день назад)");
    expect(describeTurn(turn(2), "day")).toBe("Лапин (2 дня назад)");
    expect(describeTurn(turn(5), "day")).toBe("Лапин (5 дней назад)");
    expect(describeTurn(turn(11), "day")).toBe("Лапин (11 дней назад)");
  });

  it("says «сегодня» rather than «0 дней назад»", () => {
    expect(describeTurn(turn(0), "day")).toBe("Лапин (сегодня)");
  });
});
