import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift, listShiftsByEmployee } from "../repo/shifts";
import { createVacantSlot, createAssignment, confirmAssignment } from "../repo/weekend";
import {
  postSlot,
  expressInterest,
  interestedForSlot,
  assignSlot,
  confirmOffer,
  declineOffer,
  payrollRows,
  payrollCsv,
  openSlotsForWorker,
  myOffers,
} from "./weekend-service";

describe("weekend market service", () => {
  it("full flow: post -> interest -> fairness order -> assign -> confirm -> shift + payroll", () => {
    const db = makeTestDb();
    const fair = createEmployee(db, { displayName: "Аня" }); // no prior confirmed work
    const busy = createEmployee(db, { displayName: "Игорь" }); // already has a confirmed assignment this month

    // seed `busy` with a prior confirmed assignment in the same month so fairness ordering is observable
    const priorSlot = createVacantSlot(db, { date: "2026-07-05", start: "09:00", end: "17:00" });
    const priorAssignment = createAssignment(db, { slotId: priorSlot.id, employeeId: busy.id, hours: 8 });
    const priorShift = createShift(db, { date: priorSlot.date, start: priorSlot.start, end: priorSlot.end, category: "weekend_work", employeeId: busy.id });
    confirmAssignment(db, priorAssignment.id, priorShift.id);

    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00", title: "Суббота" });
    expect(slot.status).toBe("open");

    expect(expressInterest(db, slot.id, fair.id).ok).toBe(true);
    expect(expressInterest(db, slot.id, busy.id).ok).toBe(true);

    const interested = interestedForSlot(db, slot.id);
    expect(interested.map((i) => i.employeeId)).toEqual([fair.id, busy.id]);
    expect(interested[0]!.confirmedThisMonth).toBe(0);
    expect(interested[1]!.confirmedThisMonth).toBe(1);

    const assigned = assignSlot(db, slot.id, fair.id);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) throw new Error("unreachable");
    expect(assigned.assignment.hours).toBe(8);

    const confirmed = confirmOffer(db, assigned.assignment.id, fair.id);
    expect(confirmed.ok).toBe(true);

    const fairShifts = listShiftsByEmployee(db, fair.id);
    expect(fairShifts.length).toBe(1);
    expect(fairShifts[0]!.category).toBe("weekend_work");
    expect(fairShifts[0]!.date).toBe("2026-07-18");

    const rows = payrollRows(db, "2026-07-01", "2026-07-31");
    const fairRow = rows.find((r) => r.employeeId === fair.id);
    expect(fairRow).toBeDefined();
    expect(fairRow!.hours).toBe(8);
    expect(fairRow!.date).toBe("2026-07-18");

    const csv = payrollCsv(rows);
    expect(csv.startsWith("Работник,Дата,Часы")).toBe(true);
    expect(csv).toContain("Аня,2026-07-18,8");
  });

  it("expressInterest on a non-open slot is not ok", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    const other = createEmployee(db, { displayName: "Аня" });
    expressInterest(db, slot.id, other.id);
    const assigned = assignSlot(db, slot.id, other.id);
    expect(assigned.ok).toBe(true);
    const res = expressInterest(db, slot.id, worker.id);
    expect(res.ok).toBe(false);
  });

  it("confirming by the wrong worker is not ok", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Аня" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("unreachable");
    const res = confirmOffer(db, assigned.assignment.id, other.id);
    expect(res.ok).toBe(false);
  });

  it("declining reopens the slot", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("unreachable");
    const res = declineOffer(db, assigned.assignment.id, worker.id);
    expect(res.ok).toBe(true);
    const reopened = openSlotsForWorker(db, worker.id, "2026-07-01");
    expect(reopened.map((s) => s.slot.id)).toContain(slot.id);
  });

  it("openSlotsForWorker flags interested slots and myOffers lists offered+confirmed", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    let open = openSlotsForWorker(db, worker.id, "2026-07-01");
    expect(open.find((s) => s.slot.id === slot.id)?.interested).toBe(false);

    expressInterest(db, slot.id, worker.id);
    open = openSlotsForWorker(db, worker.id, "2026-07-01");
    expect(open.find((s) => s.slot.id === slot.id)?.interested).toBe(true);

    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("unreachable");
    const offers = myOffers(db, worker.id);
    expect(offers.map((o) => o.assignment.id)).toContain(assigned.assignment.id);
    expect(offers[0]!.slot.id).toBe(slot.id);
  });
});
