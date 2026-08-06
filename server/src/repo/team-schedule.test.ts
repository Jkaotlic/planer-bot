import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "./employees";
import { createShift } from "./shifts";
import { readTeamSchedule } from "./team-schedule";

describe("readTeamSchedule", () => {
  it("отдаёт активных людей и их смены за окно", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.employees.map((e) => e.displayName)).toEqual(["Иванов Иван"]);
    expect(view.shifts).toHaveLength(1);
    expect(view.shifts[0]!.date).toBe("2026-08-05");
  });

  it("не отдаёт смены архивных — их некуда рисовать", () => {
    const db = makeTestDb();
    const departed = createEmployee(db, { displayName: "Петров Пётр" });
    createShift(db, { employeeId: departed.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
    // The third argument is required: archiving only drops the person from
    // shifts starting on that date. The date is deliberately AFTER the shift —
    // that way the shift stays attributed to the archived employee, which is
    // exactly the case the grid has nothing to draw: there's no row left for
    // that person. If we archived with a date before the shift, it would
    // become ownerless, and the test would check something else entirely.
    archiveEmployee(db, departed.id, "2026-08-06");

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.employees).toHaveLength(0);
    expect(view.shifts).toHaveLength(0);
  });

  it("берёт только своё окно и не задевает соседние недели", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    for (const date of ["2026-08-02", "2026-08-05", "2026-08-10"]) {
      createShift(db, { employeeId: ivanov.id, date, start: "08:00", end: "20:00", category: "shift" });
    }

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.shifts.map((shift) => shift.date)).toEqual(["2026-08-05"]);
  });

  it("тянет многодневный отпуск, начавшийся до окна", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-07-28", endDate: "2026-08-05", category: "vacation" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    // The vacation started last week, but it covers three days of this one —
    // it has no right to drop out. That's exactly why this uses
    // listShiftsOverlapping, not listShiftsInRange.
    expect(view.shifts).toHaveLength(1);
  });

  it("оставляет ничейные смены — им отведена своя строка", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: null, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(view.shifts).toHaveLength(1);
    expect(view.shifts[0]!.employeeId).toBeNull();
  });

  it("не отдаёт админскую заметку", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, {
      employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00",
      category: "shift", note: "внутренняя пометка",
    });

    const view = readTeamSchedule(db, "2026-08-03", "2026-08-09");

    expect(JSON.stringify(view)).not.toContain("внутренняя пометка");
  });
});
