import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift, getShift, updateShift } from "../repo/shifts";
import { getSwapRequest, createSwapRequest } from "../repo/swaps";
import { setSwapsLocked } from "../repo/settings";
import { employees, shiftTemplates } from "../db/schema";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "./swap-service";

const NOW = { date: "2026-07-01", time: "12:00" };

function setup() {
  const db = makeTestDb();
  const a = createEmployee(db, { displayName: "Аня" });
  const b = createEmployee(db, { displayName: "Игорь" });
  const sa = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
  const sb = createShift(db, { date: "2026-07-10", start: "11:00", end: "20:00", employeeId: b.id });
  return { db, a, b, sa, sb };
}

describe("swap service", () => {
  it("createSwap validates ownership + swappability", () => {
    const { db, a, b, sa, sb } = setup();
    expect(createSwap(db, { fromEmployeeId: b.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW).ok).toBe(false); // sa isn't b's
    const ok = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.counterpartyId).toBe(b.id);
  });

  it("createSwap rejects a duplicate (fromShiftId,toShiftId) pending swap", () => {
    const { db, a, sa, sb } = setup();
    const first = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(first.ok).toBe(true);
    const second = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(second).toEqual({ ok: false, reason: "duplicate" });
  });

  // The recheck at accept-time already refuses a shift that has started, so a
  // request created on one is born dead: it only ever answers «Смена уже прошла»,
  // after having pinged the counterparty with live-looking buttons.
  // Меняться можно только внутри дня, поэтому «уже началась» — это про сегодня:
  // NOW = 12:00, утренняя смена началась, вечерняя ещё впереди.
  it("createSwap refuses a shift that has already started, on either side", () => {
    const { db, a, b } = setup();
    const myEvening = createShift(db, { date: NOW.date, start: "15:00", end: "23:00", employeeId: a.id });
    const theirMorning = createShift(db, { date: NOW.date, start: "08:00", end: "17:00", employeeId: b.id });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: myEvening.id, toShiftId: theirMorning.id }, NOW))
      .toEqual({ ok: false, reason: "to-shift-in-past" });

    const myMorning = createShift(db, { date: NOW.date, start: "09:00", end: "18:00", employeeId: a.id });
    const theirEvening = createShift(db, { date: NOW.date, start: "16:00", end: "23:00", employeeId: b.id });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: myMorning.id, toShiftId: theirEvening.id }, NOW))
      .toEqual({ ok: false, reason: "from-shift-in-past" });
  });

  // The overlap rule was only enforced when accepting. Proposing an impossible
  // trade still pinged the counterparty with live-looking buttons whose only
  // possible answer was an error — and, when the conflict was the initiator's,
  // an error phrased as if it were the counterparty's.
  it("createSwap refuses a trade that would double-book either side", () => {
    const { db, a, b, sa, sb } = setup();
    // Аня already works something that overlaps Игоря's shift — she can't take it.
    const hers = createShift(db, { date: sb.date, start: "10:00", end: "14:00", employeeId: a.id });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "double-booking-from" });

    updateShift(db, hers.id, { employeeId: b.id, date: sa.date, start: "09:00", end: "12:00" });
    // Now the overlap is on Игоря's side: he can't take Ани's shift.
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "double-booking-to" });
  });

  // Roster import writes an unreadable cell as a `shift` row with no clock times —
  // there is nothing to compare against "now" and nothing to hand over.
  it("createSwap refuses a shift with no times", () => {
    const { db, a, b, sa } = setup();
    const timeless = createShift(db, { date: "2026-07-12", start: null, end: null, employeeId: b.id, unrecognisedCode: "Ко" });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: timeless.id }, NOW))
      .toEqual({ ok: false, reason: "not_swappable" });
  });

  // Two people agree in person and each opens a request from their own side. It is
  // one and the same trade, and letting both exist meant whoever accepted first
  // sent the other person two contradicting messages: «Твой обмен приняли ✅» and,
  // a line later, «отменился — смена уже досталась другому».
  it("createSwap rejects the mirror of a pending swap, pointing at the request that already exists", () => {
    const { db, a, b, sa, sb } = setup();
    const first = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(first.ok).toBe(true);
    const mirrored = createSwap(db, { fromEmployeeId: b.id, fromShiftId: sb.id, toShiftId: sa.id }, NOW);
    expect(mirrored).toEqual({ ok: false, reason: "mirror" });
  });

  it("createSwap allows the mirror once the original is no longer pending", () => {
    const { db, a, b, sa, sb } = setup();
    const first = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!first.ok) throw new Error("setup");
    expect(cancelSwap(db, first.request.id, a.id).ok).toBe(true);
    // Аня withdrew hers; Игорь proposing the same trade is a new offer, not a duplicate.
    expect(createSwap(db, { fromEmployeeId: b.id, fromShiftId: sb.id, toShiftId: sa.id }, NOW).ok).toBe(true);
  });

  it("accept exchanges the shifts atomically and cancels siblings", () => {
    const { db, a, b, sa, sb } = setup();
    const c = createEmployee(db, { displayName: "Марк" });
    // Тот же день, что sa и sb, — иначе обмен Марка невозможен в принципе.
    const sc = createShift(db, { date: "2026-07-10", start: "18:00", end: "22:00", employeeId: c.id });
    const main = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    const sibling = createSwap(db, { fromEmployeeId: c.id, fromShiftId: sc.id, toShiftId: sa.id }, NOW); // also wants sa
    if (!main.ok || !sibling.ok) throw new Error("setup");

    const res = acceptSwap(db, main.request.id, b.id, NOW);
    expect(res.ok).toBe(true);
    expect(getShift(db, sa.id)?.employeeId).toBe(b.id);   // exchanged
    expect(getShift(db, sb.id)?.employeeId).toBe(a.id);
    expect(getSwapRequest(db, main.request.id)?.status).toBe("accepted");
    expect(getSwapRequest(db, sibling.request.id)?.status).toBe("cancelled"); // sibling touching sa auto-cancelled
    if (res.ok) {
      expect(res.counterpartyId).toBe(a.id);
      // Callers need to know who to notify about the auto-cancellation — the
      // sibling's own counterparty (a, who held the live Принять/Отклонить
      // message for c's proposal) is left holding a now-stale message.
      expect(res.cancelledSiblings).toHaveLength(1);
      expect(res.cancelledSiblings?.[0]?.id).toBe(sibling.request.id);
      expect(res.cancelledSiblings?.[0]?.toEmployeeId).toBe(a.id);
    }
  });

  it("accept exposes no cancelled siblings when there aren't any", () => {
    const { db, a, b, sa, sb } = setup();
    const main = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!main.ok) throw new Error("setup");
    const res = acceptSwap(db, main.request.id, b.id, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cancelledSiblings).toEqual([]);
  });

  it("accept only by the counterparty, only while pending", () => {
    const { db, a, b, sa, sb } = setup();
    const req = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!req.ok) throw new Error("setup");
    expect(acceptSwap(db, req.request.id, a.id, NOW).ok).toBe(false); // initiator can't accept
    expect(acceptSwap(db, req.request.id, b.id, NOW).ok).toBe(true);
    expect(acceptSwap(db, req.request.id, b.id, NOW).ok).toBe(false); // already resolved
  });

  it("accept rejected + expired when it would double-book the counterparty", () => {
    const { db, a, b, sa, sb } = setup();
    const req = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!req.ok) throw new Error("setup");
    // The conflict appears only *after* the proposal — b picks up a shift that
    // overlaps sa (2026-07-10 08:00–17:00). Creating it in this state is refused
    // outright now, so this is the one way the accept-time check still fires.
    createShift(db, { date: "2026-07-10", start: "09:00", end: "12:00", employeeId: b.id });
    const res = acceptSwap(db, req.request.id, b.id, NOW);
    expect(res.ok).toBe(false);
    expect(getShift(db, sa.id)?.employeeId).toBe(a.id); // NOT exchanged
    expect(getSwapRequest(db, req.request.id)?.status).toBe("expired");
  });

  it("decline and cancel are role-gated", () => {
    const { db, a, b, sa, sb } = setup();
    const r1 = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!r1.ok) throw new Error("s");
    expect(declineSwap(db, r1.request.id, a.id).ok).toBe(false); // initiator can't decline
    expect(declineSwap(db, r1.request.id, b.id).ok).toBe(true);
    const r2 = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!r2.ok) throw new Error("s");
    expect(cancelSwap(db, r2.request.id, b.id).ok).toBe(false); // counterparty can't cancel
    expect(cancelSwap(db, r2.request.id, a.id).ok).toBe(true);
  });

  it("degrades gracefully (no crash) when a swappable shift has a null time", () => {
    const { db, a, b, sb } = setup();
    const bad = createShift(db, { date: "2026-07-10", start: "08:00", end: null, category: "shift", employeeId: a.id });
    const req = createSwapRequest(db, { fromEmployeeId: a.id, fromShiftId: bad.id, toEmployeeId: b.id, toShiftId: sb.id });
    const res = acceptSwap(db, req.id, b.id, NOW);
    expect(res.ok).toBe(false);
    expect(getSwapRequest(db, req.id)?.status).toBe("expired");
  });
});

describe("swap service under admin restrictions", () => {
  it("createSwap refuses while swaps are locked, and allows once unlocked", () => {
    const { db, a, b, sa, sb } = setup();
    setSwapsLocked(db, true, b.id);
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "swaps-locked" });
    setSwapsLocked(db, false, b.id);
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW).ok).toBe(true);
  });

  /**
   * The one test this whole feature rests on.
   *
   * The bot's «Принять» button calls `acceptSwap` directly (`bot.ts:459`), never
   * through an HTTP route — a guard placed in the route would leave that button
   * working while the Mini App was locked. The request here is created BEFORE the
   * lock, deliberately: `lockSwaps` (Task 3) cancels open requests, and a test
   * relying on that would be proving the cancellation, not the guard.
   */
  it("acceptSwap refuses while swaps are locked", () => {
    const { db, a, b, sa, sb } = setup();
    const proposed = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    setSwapsLocked(db, true, b.id);
    expect(acceptSwap(db, proposed.request.id, b.id, NOW))
      .toMatchObject({ ok: false, reason: "swaps-locked" });
  });

  /**
   * The guard's own failure mode, not the lock's: `swaps-locked` is admin
   * state, not a fact about the shifts, so refusing here must NOT do what
   * `unavailable`/`identical-shift`/etc. do — write `expired` and hand back an
   * `expired` request. That would tell the initiator their swap died because
   * a shift moved, which is false; unlocking makes this very same request
   * valid again. The existing "refuses while locked" test above only pins the
   * `reason` (`toMatchObject` passes whether or not status changed) — this
   * one pins the survival.
   */
  it("acceptSwap under lock leaves the request pending, not expired", () => {
    const { db, a, b, sa, sb } = setup();
    const proposed = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    setSwapsLocked(db, true, b.id);
    const res = acceptSwap(db, proposed.request.id, b.id, NOW);
    expect(res).toEqual({ ok: false, reason: "swaps-locked" });
    expect(getSwapRequest(db, proposed.request.id)?.status).toBe("pending");
  });

  it("decline and cancel stay open while swaps are locked", () => {
    const { db, a, b, sa, sb } = setup();
    const first = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!first.ok) throw new Error("setup failed");
    setSwapsLocked(db, true, b.id);
    expect(declineSwap(db, first.request.id, b.id).ok).toBe(true);
  });

  it("createSwap refuses when the initiator is excluded, and allows once the flag is cleared", () => {
    const { db, a, b, sa, sb } = setup();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, a.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "from-excluded" });
    db.update(employees).set({ excludedFromSwaps: false }).where(eq(employees.id, a.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW).ok).toBe(true);
  });

  it("createSwap refuses when the counterparty is excluded", () => {
    const { db, a, b, sa, sb } = setup();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, b.id)).run();
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "to-excluded" });
  });
});

/**
 * Дежурство обменивается как смена — его решение от 2026-08-10.
 *
 * Пул дежурства при этом ничего не запрещает: он остаётся правилом автораздачи,
 * а не правом. Поэтому здесь нет ни одного теста «отказал из-за пула» —
 * отказывать нечем.
 */
describe("обмен дежурствами", () => {
  function dutySetup() {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const pokl = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Поклонка", category: "duty", start: "09:00", end: "18:00", location: "Поклонка" })
      .returning()
      .all()[0]!;
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: pokl.id, title: pokl.name, employeeId: anya.id,
    });
    const shift = createShift(db, { date: "2026-07-10", start: "11:00", end: "20:00", employeeId: igor.id });
    return { db, anya, igor, pokl, duty, shift };
  }

  it("дежурство меняется на обычную смену того же дня и исполняется", () => {
    const { db, anya, igor, duty, shift } = dutySetup();
    const proposed = createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const accepted = acceptSwap(db, proposed.request.id, igor.id, NOW);
    expect(accepted.ok).toBe(true);
    expect(getShift(db, duty.id)!.employeeId).toBe(igor.id);
    expect(getShift(db, shift.id)!.employeeId).toBe(anya.id);
  });

  // Третий человек, а не Игорь из `dutySetup`: у того в этот день уже стоит смена
  // 11:00–20:00, и Поклонка 09:00–18:00 оставила бы его с двойным букингом —
  // правильный отказ, но не про то, что здесь проверяется.
  it("два разных дежурства в один день — настоящий обмен", () => {
    const { db, anya, duty } = dutySetup();
    const mark = createEmployee(db, { displayName: "Марк" });
    const v19 = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Вавилова 19", category: "duty", start: "10:00", end: "19:00", location: "Вавилова 19" })
      .returning()
      .all()[0]!;
    const his = createShift(db, {
      date: duty.date, start: "10:00", end: "19:00", category: "duty",
      templateId: v19.id, title: v19.name, employeeId: mark.id,
    });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: his.id }, NOW).ok).toBe(true);
  });

  it("одно и то же дежурство у обоих — обмен ничего не изменит", () => {
    const { db, anya, igor, pokl, duty } = dutySetup();
    const his = createShift(db, {
      date: duty.date, start: "09:00", end: "18:00", category: "duty",
      templateId: pokl.id, title: pokl.name, employeeId: igor.id,
    });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: his.id }, NOW))
      .toEqual({ ok: false, reason: "identical-shift" });
  });

  // Сторож: открыли ровно дежурство и ничего больше.
  it.each(["offsite", "weekend_work", "vacation", "sick_leave", "business_trip"] as const)(
    "%s обменять по-прежнему нельзя",
    (category) => {
      const { db, anya, igor, duty } = dutySetup();
      const theirs = createShift(db, { date: duty.date, start: "11:00", end: "20:00", category, employeeId: igor.id });
      expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: theirs.id }, NOW))
        .toEqual({ ok: false, reason: "not_swappable" });
    },
  );

  // Сторож: дежурство без часов — это нечитаемая клетка импорта, отдавать нечего.
  it("дежурство без часов обменять нельзя", () => {
    const { db, anya, shift } = dutySetup();
    const timeless = createShift(db, { date: shift.date, category: "duty", employeeId: anya.id });
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: timeless.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "not_swappable" });
  });

  // Сторожа: общие запреты действуют на дежурство ровно так же, как на смену.
  it("лок обменов закрывает и дежурства", () => {
    const { db, anya, duty, shift } = dutySetup();
    setSwapsLocked(db, true, anya.id);
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "swaps-locked" });
  });

  it("исключённый из обменов не отдаёт и не берёт дежурство", () => {
    const { db, anya, igor, duty, shift } = dutySetup();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, anya.id)).run();
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "from-excluded" });

    db.update(employees).set({ excludedFromSwaps: false }).where(eq(employees.id, anya.id)).run();
    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, igor.id)).run();
    expect(createSwap(db, { fromEmployeeId: anya.id, fromShiftId: duty.id, toShiftId: shift.id }, NOW))
      .toEqual({ ok: false, reason: "to-excluded" });
  });
});
