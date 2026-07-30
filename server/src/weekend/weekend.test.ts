import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "../repo/employees";
import { createShift, listShiftsByEmployee, updateShift, deleteShift } from "../repo/shifts";
import { createVacantSlot, createAssignment, confirmAssignment, setSlotStatus, addInterest } from "../repo/weekend";

/** Fixtures use fixed 2026-07 dates, so «today» has to sit before them. */
const TEST_TODAY = "2026-07-01";
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

    expect(expressInterest(db, slot.id, fair.id, TEST_TODAY).ok).toBe(true);
    expect(expressInterest(db, slot.id, busy.id, TEST_TODAY).ok).toBe(true);

    const interested = interestedForSlot(db, slot.id);
    expect(interested.map((i) => i.employeeId)).toEqual([fair.id, busy.id]);
    expect(interested[0]!.confirmedThisMonth).toBe(0);
    expect(interested[1]!.confirmedThisMonth).toBe(1);

    const assigned = assignSlot(db, slot.id, fair.id, TEST_TODAY);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) throw new Error("unreachable");
    expect(assigned.assignment.hours).toBe(8);

    const confirmed = confirmOffer(db, assigned.assignment.id, fair.id);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.slotId).toBe(slot.id); // callers build "<name> confirmed <slot>" without a second lookup

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
    expressInterest(db, slot.id, other.id, TEST_TODAY);
    expect(assignSlot(db, slot.id, other.id, TEST_TODAY).ok).toBe(true);

    // Still open: someone else can volunteer and be assigned alongside.
    expect(expressInterest(db, slot.id, worker.id, TEST_TODAY).ok).toBe(true);
    expect(assignSlot(db, slot.id, worker.id, TEST_TODAY).ok).toBe(true);
    expect(assigneesForSlot(db, slot.id).map((a) => a.employeeId).sort()).toEqual([other.id, worker.id].sort());
    expect(openSlotsForWorker(db, worker.id, "2026-07-01").map((s) => s.slot.id)).toContain(slot.id);
  });

  it("expressInterest on a closed slot is not ok", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = createVacantSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    setSlotStatus(db, slot.id, "closed");
    expect(expressInterest(db, slot.id, worker.id, TEST_TODAY).ok).toBe(false);
  });

  it("assigning puts the entry in the schedule right away; unassigning takes it back out", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00", title: "Суббота" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("unreachable");

    const scheduled = listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.date).toBe("2026-07-18");

    const unassigned = unassign(db, assigned.assignment.id);
    expect(unassigned.ok).toBe(true);
    // Callers (the unassign HTTP route) need this to notify the worker who was
    // just taken off — the assignment row is gone the moment this returns.
    if (unassigned.ok) {
      expect(unassigned.employeeId).toBe(worker.id);
      expect(unassigned.slotId).toBe(slot.id);
    }
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(0);
    expect(assigneesForSlot(db, slot.id)).toHaveLength(0);
  });

  it("confirming by the wrong worker is not ok", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Аня" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("unreachable");
    const res = confirmOffer(db, assigned.assignment.id, other.id);
    expect(res.ok).toBe(false);
  });

  it("declining pulls the entry out of the schedule and drops them off the slot", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
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

    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    open = openSlotsForWorker(db, worker.id, "2026-07-01");
    expect(open.find((s) => s.slot.id === slot.id)?.interested).toBe(true);

    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("unreachable");
    const offers = myOffers(db, worker.id);
    expect(offers.map((o) => o.assignment.id)).toContain(assigned.assignment.id);
    expect(offers[0]!.slot.id).toBe(slot.id);
  });

  it("re-assigning the same person to the same slot leaves exactly one weekend_work shift", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);

    const first = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!first.ok) throw new Error("unreachable");
    // Admin double-taps "Назначить" on the same person.
    const second = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!second.ok) throw new Error("unreachable");

    expect(second.assignment.id).toBe(first.assignment.id);
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(1);
    expect(assigneesForSlot(db, slot.id)).toHaveLength(1);
  });

  it("re-assigning a confirmed worker does not bounce them back to offered", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("unreachable");
    expect(confirmOffer(db, assigned.assignment.id, worker.id).ok).toBe(true);

    const reassigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!reassigned.ok) throw new Error("unreachable");
    expect(reassigned.assignment.status).toBe("confirmed");
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(1);
  });

  it("unassign after a re-assign leaves no weekend_work shift behind", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    assignSlot(db, slot.id, worker.id, TEST_TODAY);
    const reassigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!reassigned.ok) throw new Error("unreachable");

    expect(unassign(db, reassigned.assignment.id).ok).toBe(true);
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(0);
  });

  it("re-offering after a decline still leaves exactly one weekend_work shift", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("unreachable");
    expect(declineOffer(db, assigned.assignment.id, worker.id).ok).toBe(true);

    const reoffered = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!reoffered.ok) throw new Error("unreachable");
    expect(reoffered.assignment.status).toBe("offered");
    expect(listShiftsByEmployee(db, worker.id).filter((s) => s.category === "weekend_work")).toHaveLength(1);
  });

  it("ranks equal candidates by who has been passed over most (volunteered, lost the slot)", () => {
    const db = makeTestDb();
    const passedOver = createEmployee(db, { displayName: "Аня" });
    const chosen = createEmployee(db, { displayName: "Борис" });

    // Both wanted an earlier slot; it went to Борис, so Аня was passed over once.
    const earlier = postSlot(db, { date: "2026-07-11", start: "09:00", end: "17:00" });
    expressInterest(db, earlier.id, passedOver.id, TEST_TODAY);
    expressInterest(db, earlier.id, chosen.id, TEST_TODAY);
    assignSlot(db, earlier.id, chosen.id, TEST_TODAY);

    const slot = postSlot(db, { date: "2026-07-18", start: "09:00", end: "17:00" });
    expressInterest(db, slot.id, passedOver.id, TEST_TODAY);
    expressInterest(db, slot.id, chosen.id, TEST_TODAY);

    const ranked = interestedForSlot(db, slot.id);
    // Neither has actually *worked* a weekend yet, so the tiebreak decides.
    expect(ranked.map((i) => i.confirmedThisMonth)).toEqual([0, 0]);
    expect(ranked[0]!.employeeId).toBe(passedOver.id);
    expect(ranked[0]!.passedOver).toBe(1);
    expect(ranked[1]!.passedOver).toBe(0);
  });
});

// The bot's buttons and the HTTP middleware both refuse an archived person at the
// door — but the door they guard is the *actor's*. An admin assigning somebody
// else is an active actor picking an archived target, and that path had no check
// at all: the person was written into a `weekend_work` shift on a schedule they
// had just been taken off.
describe("the weekend market and archived people", () => {
  const SLOT = { date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка" };

  it("refuses to assign an archived worker to a slot", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, SLOT);
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    archiveEmployee(db, worker.id, "2026-01-01");

    expect(assignSlot(db, slot.id, worker.id, TEST_TODAY)).toEqual({ ok: false, reason: "not_active" });
    expect(listShiftsByEmployee(db, worker.id)).toHaveLength(0);
  });

  it("drops an archived volunteer from the «кто хочет» list", () => {
    const db = makeTestDb();
    const staying = createEmployee(db, { displayName: "Первый Работник" });
    const leaving = createEmployee(db, { displayName: "Второй Работник" });
    const slot = createVacantSlot(db, SLOT);
    expressInterest(db, slot.id, staying.id, TEST_TODAY);
    expressInterest(db, slot.id, leaving.id, TEST_TODAY);
    archiveEmployee(db, leaving.id, "2026-01-01");

    // Otherwise the admin sees a name with no mark on it and picks it.
    expect(interestedForSlot(db, slot.id).map((i) => i.employeeId)).toEqual([staying.id]);
  });

  it("refuses to record interest from an archived worker", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, SLOT);
    archiveEmployee(db, worker.id, "2026-01-01");

    expect(expressInterest(db, slot.id, worker.id, TEST_TODAY)).toEqual({ ok: false, reason: "not_active" });
    expect(interestedForSlot(db, slot.id)).toHaveLength(0);
  });
});

/**
 * Every posted slot leaves a «🙋 Хочу» button in twenty-eight Telegram chats, and
 * a Telegram button lives forever. The mini-app stops showing a slot once its date
 * has passed; the button doesn't, and neither did the code behind it.
 */
describe("a slot that has already passed", () => {
  const PAST_SATURDAY = "2020-01-04";
  const TODAY = "2026-07-30";

  it("refuses «хочу» from a stale button", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, { date: PAST_SATURDAY, start: "10:00", end: "18:00" });

    expect(expressInterest(db, slot.id, worker.id, TODAY)).toEqual({ ok: false, reason: "slot_passed" });
    expect(interestedForSlot(db, slot.id)).toHaveLength(0);
  });

  it("refuses an assignment, so nobody gets a weekend_work entry in the past", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, { date: PAST_SATURDAY, start: "10:00", end: "18:00" });
    // Interest recorded back when the slot was still ahead.
    expect(expressInterest(db, slot.id, worker.id, PAST_SATURDAY).ok).toBe(true);

    expect(assignSlot(db, slot.id, worker.id, TODAY)).toEqual({ ok: false, reason: "slot_passed" });
    expect(listShiftsByEmployee(db, worker.id)).toHaveLength(0);
  });

  it("still lets the day itself be worked — «today» is not «passed»", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, { date: "2026-08-01", start: "10:00", end: "18:00" });
    expect(expressInterest(db, slot.id, worker.id, "2026-08-01").ok).toBe(true);
    expect(assignSlot(db, slot.id, worker.id, "2026-08-01").ok).toBe(true);
  });
});

/** The second write path for a `weekend_work` entry: the marketplace, which never
 *  goes through `createEntrySchema`. Its own check, not the route's. */
describe("assignSlot only ever writes a weekend entry on a weekend", () => {
  it("refuses a slot that somehow sits on a weekday", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const monday = createVacantSlot(db, { date: "2026-08-03", start: "10:00", end: "18:00" });
    // Seeded straight into the table: «хочу» is refused on a weekday slot by the
    // same rule, so this is the state a slot created before the guard would be in.
    addInterest(db, monday.id, worker.id);

    expect(assignSlot(db, monday.id, worker.id, "2026-07-30")).toEqual({ ok: false, reason: "not_weekend" });
    expect(listShiftsByEmployee(db, worker.id)).toHaveLength(0);
  });
});

/**
 * Расписание — источник правды (решение Антона, 2026-07-30). Часы и дата в
 * выгрузке на оплату берутся из записи в расписании, а не из снимка, сделанного
 * в момент назначения: админ правит смену там, где на неё смотрит.
 */
describe("payroll follows the schedule, not the snapshot taken at assign time", () => {
  const SATURDAY = "2026-08-01";
  const SUNDAY = "2026-08-02";

  function confirmedOn(db: ReturnType<typeof makeTestDb>, date: string) {
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, { date, start: "10:00", end: "18:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    const assigned = assignSlot(db, slot.id, worker.id, TEST_TODAY);
    if (!assigned.ok) throw new Error("setup");
    confirmOffer(db, assigned.assignment.id, worker.id);
    return { worker, slot, shiftId: assigned.assignment.shiftId! };
  }

  it("takes the hours from the entry after an admin shortens it", () => {
    const db = makeTestDb();
    const { shiftId } = confirmedOn(db, SATURDAY);
    expect(payrollRows(db, SATURDAY, SUNDAY)[0]!.hours).toBe(8);

    updateShift(db, shiftId, { start: "10:00", end: "13:00" });
    expect(payrollRows(db, SATURDAY, SUNDAY)[0]!.hours).toBe(3);
  });

  it("follows the entry to another day, in and out of the range", () => {
    const db = makeTestDb();
    const { shiftId } = confirmedOn(db, SATURDAY);
    updateShift(db, shiftId, { date: SUNDAY });

    expect(payrollRows(db, SUNDAY, SUNDAY).map((r) => r.date)).toEqual([SUNDAY]);
    expect(payrollRows(db, SATURDAY, SATURDAY)).toEqual([]);
  });

  it("drops work the admin took out of the schedule — the deletion is in the journal", () => {
    const db = makeTestDb();
    const { shiftId } = confirmedOn(db, SATURDAY);
    deleteShift(db, shiftId);
    expect(payrollRows(db, SATURDAY, SUNDAY)).toEqual([]);
  });
});

/**
 * Его решение: не блокировать, а показать. Человек мог поднять руку в мае, а
 * отпуск на эту субботу появиться в июне — админ смотрит в список и не видит
 * ничего. «Распределить честно» отсутствие считает жёстким запретом; здесь
 * запрета нет, но и молчания быть не должно.
 */
describe("«кто хочет» marks a volunteer who is away that day", () => {
  const SATURDAY = "2026-08-01";

  it("names the absence, and назначить всё равно можно", () => {
    const db = makeTestDb();
    const away = createEmployee(db, { displayName: "Первый Работник" });
    const here = createEmployee(db, { displayName: "Второй Работник" });
    const slot = createVacantSlot(db, { date: SATURDAY, start: "10:00", end: "18:00" });
    expressInterest(db, slot.id, away.id, TEST_TODAY);
    expressInterest(db, slot.id, here.id, TEST_TODAY);
    // Отпуск заведён позже и накрывает эту субботу.
    createShift(db, { date: "2026-07-28", endDate: "2026-08-05", category: "vacation", employeeId: away.id, start: null, end: null });

    const listed = interestedForSlot(db, slot.id);
    expect(listed.find((i) => i.employeeId === away.id)?.absence).toBe("vacation");
    expect(listed.find((i) => i.employeeId === here.id)?.absence).toBeNull();

    // Пометка, а не запрет — иногда человек сам просит выйти из отпуска.
    expect(assignSlot(db, slot.id, away.id, TEST_TODAY).ok).toBe(true);
  });

  it("only marks an absence that actually covers the slot's day", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Первый Работник" });
    const slot = createVacantSlot(db, { date: SATURDAY, start: "10:00", end: "18:00" });
    expressInterest(db, slot.id, worker.id, TEST_TODAY);
    createShift(db, { date: "2026-07-20", endDate: "2026-07-24", category: "sick_leave", employeeId: worker.id, start: null, end: null });

    expect(interestedForSlot(db, slot.id)[0]!.absence).toBeNull();
  });
});
