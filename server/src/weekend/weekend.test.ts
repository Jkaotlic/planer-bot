import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift, listShiftsByEmployee } from "../repo/shifts";
import { createVacantSlot, createAssignment, confirmAssignment, setSlotStatus } from "../repo/weekend";
import {
  postSlot,
  expressInterest,
  interestedForSlot,
  assignSlot,
  unassign,
  assigneesForSlot,
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

  it("assigning someone leaves the slot open — a slot can take several people", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Аня" });
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, other.id);
    expect(assignSlot(db, slot.id, other.id).ok).toBe(true);

    // Still open: someone else can volunteer and be assigned alongside.
    expect(expressInterest(db, slot.id, worker.id).ok).toBe(true);
    expect(assignSlot(db, slot.id, worker.id).ok).toBe(true);
    expect(assigneesForSlot(db, slot.id).map((a) => a.employeeId).sort()).toEqual([other.id, worker.id].sort());
    expect(openSlotsForWorker(db, worker.id, "2026-07-01").map((s) => s.slot.id)).toContain(slot.id);
  });

  it("expressInterest on a closed slot is not ok", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    setSlotStatus(db, slot.id, "closed");
    expect(expressInterest(db, slot.id, worker.id).ok).toBe(false);
  });

  it("assigning puts the entry in the schedule right away; unassigning takes it back out", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00", title: "Суббота" });
    expressInterest(db, slot.id, worker.id);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("unreachable");

    const scheduled = listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.date).toBe("2026-07-18");

    expect(unassign(db, assigned.assignment.id).ok).toBe(true);
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(0);
    expect(assigneesForSlot(db, slot.id)).toHaveLength(0);
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

  it("declining pulls the entry out of the schedule and drops them off the slot", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id);
    const assigned = assignSlot(db, slot.id, worker.id);
    if (!assigned.ok) throw new Error("unreachable");
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(1);

    expect(declineOffer(db, assigned.assignment.id, worker.id).ok).toBe(true);
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(0);
    expect(assigneesForSlot(db, slot.id)).toHaveLength(0);
    // The slot stays on offer for someone else.
    expect(openSlotsForWorker(db, worker.id, "2026-07-01").map((s) => s.slot.id)).toContain(slot.id);
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

  it("ranks equal candidates by who has been passed over most (volunteered, lost the slot)", () => {
    const db = makeTestDb();
    const passedOver = createEmployee(db, { displayName: "Аня" });
    const chosen = createEmployee(db, { displayName: "Борис" });

    // Both wanted an earlier slot; it went to Борис, so Аня was passed over once.
    const earlier = postSlot(db, { date: "2026-07-11", start: "09:00", end: "17:00" });
    expressInterest(db, earlier.id, passedOver.id);
    expressInterest(db, earlier.id, chosen.id);
    assignSlot(db, earlier.id, chosen.id);

    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, passedOver.id);
    expressInterest(db, slot.id, chosen.id);

    const ranked = interestedForSlot(db, slot.id);
    // Neither has actually *worked* a weekend yet, so the tiebreak decides.
    expect(ranked.map((i) => i.confirmedThisMonth)).toEqual([0, 0]);
    expect(ranked[0]!.employeeId).toBe(passedOver.id);
    expect(ranked[0]!.passedOver).toBe(1);
    expect(ranked[1]!.passedOver).toBe(0);
  });
});
