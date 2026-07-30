import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { createEmployee, getEmployeeById, archiveEmployee } from "../repo/employees";
import { createShift, getShift, listShiftsInRange } from "../repo/shifts";
import { createVacantSlot, getAssignment, listAssignmentsForSlot } from "../repo/weekend";
import { expressInterest, assignSlot, unassign, confirmOffer } from "./weekend-service";
import type { Db } from "../db/client";

/**
 * Each of these functions writes to two tables to record one thing. This file
 * makes the *second* write fail — a trigger that raises on exactly the statement
 * in question — and then asks what the database is left holding.
 *
 * A trigger rather than a mocked repo on purpose: it fails the real statement in
 * the real connection, which is what a disk error, a busy lock, or a constraint
 * added later would do. Nothing here is about probability; a half-written pair is
 * a state the code must be unable to produce, however unlikely the interruption.
 */
function raiseOn(db: Db, name: string, event: string, table: string): void {
  db.run(sql.raw(`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'boom'); END;`));
}

const SLOT = { date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка" };

function slotWithVolunteer(db: Db) {
  const worker = createEmployee(db, { displayName: "Первый Работник" });
  const slot = createVacantSlot(db, SLOT);
  expressInterest(db, slot.id, worker.id);
  return { worker, slot };
}

describe("weekend assignment writes are all-or-nothing", () => {
  it("assignSlot leaves no schedule entry behind when the assignment row can't be written", () => {
    const db = makeTestDb();
    const { worker, slot } = slotWithVolunteer(db);
    raiseOn(db, "no_assignments", "INSERT", "weekend_assignments");

    expect(() => assignSlot(db, slot.id, worker.id)).toThrow();

    // Otherwise: a weekend_work entry in the schedule that no assignment explains,
    // so the slot shows nobody on it while the person's calendar says they work.
    expect(listShiftsInRange(db, SLOT.date, SLOT.date)).toHaveLength(0);
    expect(listAssignmentsForSlot(db, slot.id)).toHaveLength(0);
  });

  it("unassign keeps the schedule entry when the assignment row can't be deleted", () => {
    const db = makeTestDb();
    const { worker, slot } = slotWithVolunteer(db);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("setup");
    raiseOn(db, "no_unassign", "DELETE", "weekend_assignments");

    expect(() => unassign(db, assigned.assignment.id)).toThrow();

    // Otherwise: the person is still on the slot, with the shift gone from the schedule.
    expect(getShift(db, assigned.assignment.shiftId!)).toBeDefined();
    expect(getAssignment(db, assigned.assignment.id)).toBeDefined();
  });

  it("confirmOffer writes no orphan entry when the confirmation can't be recorded", () => {
    const db = makeTestDb();
    const { worker, slot } = slotWithVolunteer(db);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("setup");
    // The link to the schedule entry went missing — an admin deleted it directly.
    // confirmOffer then re-creates the entry and marks the offer confirmed.
    db.run(sql.raw(`UPDATE weekend_assignments SET shift_id = NULL`));
    db.run(sql.raw(`DELETE FROM shifts`));
    raiseOn(db, "no_confirm", "UPDATE", "weekend_assignments");

    expect(() => confirmOffer(db, assigned.assignment.id, worker.id)).toThrow();

    // Otherwise: a fresh weekend_work entry exists, the offer is still `offered`
    // with shift_id NULL — and the next «Назначить» writes a *second* entry
    // for the same day.
    expect(listShiftsInRange(db, SLOT.date, SLOT.date)).toHaveLength(0);
    expect(getAssignment(db, assigned.assignment.id)?.status).toBe("offered");
  });
});

describe("archiveEmployee is all-or-nothing", () => {
  it("keeps the person's shifts when the archive flag can't be written", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const future = createShift(db, { date: "2099-02-01", start: "08:00", end: "17:00", employeeId: worker.id });
    raiseOn(db, "no_archive", "UPDATE", "employees");

    expect(() => archiveEmployee(db, worker.id, "2026-01-01")).toThrow();

    // Otherwise: their future shifts are unassigned and they are still active —
    // a person who quietly lost their schedule and nobody was told.
    expect(getShift(db, future.id)?.employeeId).toBe(worker.id);
    expect(getEmployeeById(db, worker.id)?.isActive).toBe(true);
  });
});
