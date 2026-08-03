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
  listAssignmentsForSlot,
  confirmAssignment,
  listAssignmentsForEmployee,
  listConfirmedWorkInRange,
  countConfirmedByEmployeeInMonth,
  countPassedOver,
} from "./weekend";
import { weekendAssignments } from "../db/schema";
import { eq } from "drizzle-orm";

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
    expect(listAssignmentsForSlot(db, slot.id).map((a) => a.id)).toEqual([assignment.id]);

    const shift = createShift(db, { date: slot.date, start: slot.start, end: slot.end, category: "weekend_work", employeeId: worker.id });
    confirmAssignment(db, assignment.id, shift.id);

    const confirmed = listAssignmentsForSlot(db, slot.id)[0]!;
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

    // Ranged by the schedule entry, which is what pay is read off.
    const inRange = listConfirmedWorkInRange(db, "2026-07-01", "2026-07-31");
    expect(inRange.map((w) => [w.employeeId, w.date])).toEqual([[worker.id, julySlot.date]]);
    void augAssignment;
    void julyAssignment;
  });
});

/**
 * «Обойдён» = поднял руку, слот ушёл другим, а тебе места не досталось. Это
 * второй ключ справедливости: кого раз за разом обходят, тот идёт выше в списке.
 */
describe("countPassedOver", () => {
  const SLOT = { date: "2099-01-03", start: "10:00", end: "18:00" };

  it("does not count a slot the person actually got, however many others got it too", () => {
    const db = makeTestDb();
    const [first, second, third] = ["Первый Работник", "Второй Работник", "Третий Работник"]
      .map((displayName) => createEmployee(db, { displayName }));
    const slot = createVacantSlot(db, SLOT);
    for (const person of [first!, second!, third!]) {
      addInterest(db, slot.id, person.id);
      createAssignment(db, { slotId: slot.id, employeeId: person.id, hours: 8 });
    }

    // The slot needed three people and all three volunteers got it. Counting the
    // other two assignments as «passed over» made sharing a slot *earn* priority.
    expect(countPassedOver(db, first!.id)).toBe(0);
    expect(countPassedOver(db, third!.id)).toBe(0);
  });

  it("counts a slot that went to somebody else", () => {
    const db = makeTestDb();
    const missed = createEmployee(db, { displayName: "Первый Работник" });
    const got = createEmployee(db, { displayName: "Второй Работник" });
    const slot = createVacantSlot(db, SLOT);
    addInterest(db, slot.id, missed.id);
    addInterest(db, slot.id, got.id);
    createAssignment(db, { slotId: slot.id, employeeId: got.id, hours: 8 });

    expect(countPassedOver(db, missed.id)).toBe(1);
    expect(countPassedOver(db, got.id)).toBe(0);
  });

  it("does not count a slot the person was offered and turned down", () => {
    const db = makeTestDb();
    const declined = createEmployee(db, { displayName: "Первый Работник" });
    const other = createEmployee(db, { displayName: "Второй Работник" });
    const slot = createVacantSlot(db, SLOT);
    addInterest(db, slot.id, declined.id);
    addInterest(db, slot.id, other.id);
    const offer = createAssignment(db, { slotId: slot.id, employeeId: declined.id, hours: 8 });
    db.update(weekendAssignments).set({ status: "declined" }).where(eq(weekendAssignments.id, offer.id)).run();
    createAssignment(db, { slotId: slot.id, employeeId: other.id, hours: 8 });

    // They were asked and said no — that is not being passed over.
    expect(countPassedOver(db, declined.id)).toBe(0);
  });
});
