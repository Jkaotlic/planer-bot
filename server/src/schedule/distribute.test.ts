import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { buildDistribution, applyDistribution } from "./distribute-service";

describe("buildDistribution", () => {
  it("proposes assignments only for unassigned shift slots in range, never double-booking", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // existing (assigned) load, seeds each worker's balance/busy
    createShift(db, { date: "2026-07-01", start: "23:00", end: "07:00", employeeId: anya.id }); // night, already loaded

    // unassigned slots to be filled
    const night1 = createShift(db, { date: "2026-07-02", start: "23:00", end: "07:00" });
    const night2 = createShift(db, { date: "2026-07-03", start: "23:00", end: "07:00" });
    const day1 = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });
    // out of range and wrong category, must be ignored
    createShift(db, { date: "2026-01-01", start: "08:00", end: "17:00" });
    createShift(db, { date: "2026-07-02", category: "vacation" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const shiftIds = result.assignments.map((a) => a.shiftId).sort((a, b) => a - b);
    expect(shiftIds).toEqual([night1.id, day1.id, night2.id].sort((a, b) => a - b));

    // no double-booking: night1 and day1 are same-day disjoint times, both can go to same or diff employee, fine.
    // Igor is idle -> should pick up at least one of the two nights (since Anya is pre-loaded with a night)
    const nightAssignees = result.assignments
      .filter((a) => a.shiftId === night1.id || a.shiftId === night2.id)
      .map((a) => a.employeeId);
    expect(nightAssignees).toContain(igor.id);

    // employeeName resolved
    for (const a of result.assignments) {
      expect(typeof a.employeeName).toBe("string");
      expect(a.employeeName.length).toBeGreaterThan(0);
    }
  });

  it("does not assign a worker to a slot on a date they're on vacation", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Anya is on vacation the day of the unassigned slot; absences have null start/end.
    createShift(db, { date: "2026-07-02", category: "vacation", employeeId: anya.id });
    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("does not assign a worker to a slot on any date covered by a multi-day business trip", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Anya is on a business trip 2026-07-05..2026-07-07 (multi-day, expand via endDate).
    createShift(db, { date: "2026-07-05", endDate: "2026-07-07", category: "business_trip", employeeId: anya.id });
    const slot = createShift(db, { date: "2026-07-06", start: "08:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("does not double-book a worker across overlapping unassigned slots at the same time", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-05", start: "09:00", end: "17:00" });
    const s2 = createShift(db, { date: "2026-07-05", start: "10:00", end: "18:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    // only one worker exists, so only one of the two overlapping slots can be filled
    expect(result.assignments.length).toBe(1);
    expect([s1.id, s2.id]).toContain(result.assignments[0]!.shiftId);
  });
});

describe("applyDistribution", () => {
  it("sets employeeId on apply, leaves shifts untouched otherwise", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const { assignments } = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(getShift(db, s1.id)?.employeeId).toBeNull();

    applyDistribution(db, assignments.map((a) => ({ shiftId: a.shiftId, employeeId: a.employeeId })));

    for (const a of assignments) {
      expect(getShift(db, a.shiftId)?.employeeId).toBe(a.employeeId);
    }
    expect(getShift(db, s1.id)?.employeeId).toBe(anya.id);
  });
});
