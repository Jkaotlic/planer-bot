import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift } from "./shifts";
import {
  createVacantSlot,
  listOpenSlots,
  getVacantSlot,
  setSlotStatus,
  addInterest,
  listInterestedEmployeeIds,
  listMyInterestSlotIds,
  createAssignment,
  getAssignmentForSlot,
  confirmAssignment,
  listAssignmentsForEmployee,
  listConfirmedInRange,
  countConfirmedByEmployeeInMonth,
} from "./weekend";

describe("weekend market repos", () => {
  it("creates a vacant slot and lists it among open slots", () => {
    const db = makeTestDb();
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00", title: "Суббота" });
    expect(slot.status).toBe("open");
    const open = listOpenSlots(db, "2026-07-01");
    expect(open.map((s) => s.id)).toEqual([slot.id]);
    expect(getVacantSlot(db, slot.id)?.id).toBe(slot.id);
  });

  it("excludes slots before fromDate or not open", () => {
    const db = makeTestDb();
    const past = createVacantSlot(db, { date: "2026-06-01", start: "09:00", end: "17:00" });
    const future = createVacantSlot(db, { date: "2026-08-01", start: "09:00", end: "17:00" });
    setSlotStatus(db, past.id, "closed");
    const open = listOpenSlots(db, "2026-07-01");
    expect(open.map((s) => s.id)).toEqual([future.id]);
  });

  it("dedupes double 'Хочу' interest and lists interested employees", () => {
    const db = makeTestDb();
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    const a = createEmployee(db, { displayName: "Аня" });
    const b = createEmployee(db, { displayName: "Игорь" });

    addInterest(db, slot.id, a.id);
    addInterest(db, slot.id, a.id); // double add, should be harmless
    addInterest(db, slot.id, b.id);

    const interested = listInterestedEmployeeIds(db, slot.id);
    expect(interested.sort()).toEqual([a.id, b.id].sort());
    expect(listMyInterestSlotIds(db, a.id)).toEqual([slot.id]);
  });

  it("creates an offered assignment, confirms it, and links the shift", () => {
    const db = makeTestDb();
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    const worker = createEmployee(db, { displayName: "Игорь" });

    const assignment = createAssignment(db, { slotId: slot.id, employeeId: worker.id, hours: 8 });
    expect(assignment.status).toBe("offered");
    expect(getAssignmentForSlot(db, slot.id)?.id).toBe(assignment.id);

    const shift = createShift(db, { date: slot.date, start: slot.start, end: slot.end, category: "weekend_work", employeeId: worker.id });
    confirmAssignment(db, assignment.id, shift.id);

    const confirmed = getAssignmentForSlot(db, slot.id)!;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.shiftId).toBe(shift.id);
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);

    expect(listAssignmentsForEmployee(db, worker.id).map((a) => a.id)).toEqual([assignment.id]);
  });

  it("allows several people on one slot, but only one assignment per person", () => {
    const db = makeTestDb();
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    const a = createEmployee(db, { displayName: "Аня" });
    const b = createEmployee(db, { displayName: "Игорь" });
    createAssignment(db, { slotId: slot.id, employeeId: a.id, hours: 8 });
    // A slot can need more than one person.
    expect(() => createAssignment(db, { slotId: slot.id, employeeId: b.id, hours: 8 })).not.toThrow();
    // But the same person can't be put on it twice.
    expect(() => createAssignment(db, { slotId: slot.id, employeeId: a.id, hours: 8 })).toThrow();
  });

  it("counts confirmed assignments by employee within a calendar month", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Аня" });

    const julySlot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    const augSlot = createVacantSlot(db, { date: "2026-08-01", start: "09:00", end: "17:00" });

    const julyAssignment = createAssignment(db, { slotId: julySlot.id, employeeId: worker.id, hours: 8 });
    const augAssignment = createAssignment(db, { slotId: augSlot.id, employeeId: worker.id, hours: 8 });

    const julyShift = createShift(db, { date: julySlot.date, start: julySlot.start, end: julySlot.end, category: "weekend_work", employeeId: worker.id });
    confirmAssignment(db, julyAssignment.id, julyShift.id);
    // august assignment left "offered" (not confirmed) — should not count

    expect(countConfirmedByEmployeeInMonth(db, worker.id, "2026-07")).toBe(1);
    expect(countConfirmedByEmployeeInMonth(db, worker.id, "2026-08")).toBe(0);
    expect(countConfirmedByEmployeeInMonth(db, other.id, "2026-07")).toBe(0);

    const inRange = listConfirmedInRange(db, "2026-07-01", "2026-07-31");
    expect(inRange.map((a) => a.id)).toEqual([julyAssignment.id]);
    void augAssignment;
  });
});
