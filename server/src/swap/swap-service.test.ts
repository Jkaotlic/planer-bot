import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { getSwapRequest, createSwapRequest } from "../repo/swaps";
import { createSwap, acceptSwap, declineSwap, cancelSwap } from "./swap-service";

const NOW = { date: "2026-07-01", time: "12:00" };

function setup() {
  const db = makeTestDb();
  const a = createEmployee(db, { displayName: "Аня" });
  const b = createEmployee(db, { displayName: "Игорь" });
  const sa = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
  const sb = createShift(db, { date: "2026-07-11", start: "11:00", end: "20:00", employeeId: b.id });
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
  it("createSwap refuses a shift that has already started, on either side", () => {
    const { db, a, b, sa, sb } = setup();
    const past = createShift(db, { date: "2026-06-01", start: "08:00", end: "17:00", employeeId: b.id });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: past.id }, NOW))
      .toEqual({ ok: false, reason: "to-shift-in-past" });

    const myPast = createShift(db, { date: "2026-06-02", start: "08:00", end: "17:00", employeeId: a.id });
    expect(createSwap(db, { fromEmployeeId: a.id, fromShiftId: myPast.id, toShiftId: sb.id }, NOW))
      .toEqual({ ok: false, reason: "from-shift-in-past" });
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
    const sc = createShift(db, { date: "2026-07-12", start: "09:00", end: "18:00", employeeId: c.id });
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
    // b already has a shift overlapping sa (2026-07-10 08:00-17:00)
    createShift(db, { date: "2026-07-10", start: "09:00", end: "12:00", employeeId: b.id });
    const req = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id }, NOW);
    if (!req.ok) throw new Error("setup");
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
