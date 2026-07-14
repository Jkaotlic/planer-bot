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
    expect(createSwap(db, { fromEmployeeId: b.id, fromShiftId: sa.id, toShiftId: sb.id }).ok).toBe(false); // sa isn't b's
    const ok = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.counterpartyId).toBe(b.id);
  });

  it("accept exchanges the shifts atomically and cancels siblings", () => {
    const { db, a, b, sa, sb } = setup();
    const c = createEmployee(db, { displayName: "Марк" });
    const sc = createShift(db, { date: "2026-07-12", start: "09:00", end: "18:00", employeeId: c.id });
    const main = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
    const sibling = createSwap(db, { fromEmployeeId: c.id, fromShiftId: sc.id, toShiftId: sa.id }); // also wants sa
    if (!main.ok || !sibling.ok) throw new Error("setup");

    const res = acceptSwap(db, main.request.id, b.id, NOW);
    expect(res.ok).toBe(true);
    expect(getShift(db, sa.id)?.employeeId).toBe(b.id);   // exchanged
    expect(getShift(db, sb.id)?.employeeId).toBe(a.id);
    expect(getSwapRequest(db, main.request.id)?.status).toBe("accepted");
    expect(getSwapRequest(db, sibling.request.id)?.status).toBe("cancelled"); // sibling touching sa auto-cancelled
    if (res.ok) expect(res.counterpartyId).toBe(a.id);
  });

  it("accept only by the counterparty, only while pending", () => {
    const { db, a, b, sa, sb } = setup();
    const req = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
    if (!req.ok) throw new Error("setup");
    expect(acceptSwap(db, req.request.id, a.id, NOW).ok).toBe(false); // initiator can't accept
    expect(acceptSwap(db, req.request.id, b.id, NOW).ok).toBe(true);
    expect(acceptSwap(db, req.request.id, b.id, NOW).ok).toBe(false); // already resolved
  });

  it("accept rejected + expired when it would double-book the counterparty", () => {
    const { db, a, b, sa, sb } = setup();
    // b already has a shift overlapping sa (2026-07-10 08:00-17:00)
    createShift(db, { date: "2026-07-10", start: "09:00", end: "12:00", employeeId: b.id });
    const req = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
    if (!req.ok) throw new Error("setup");
    const res = acceptSwap(db, req.request.id, b.id, NOW);
    expect(res.ok).toBe(false);
    expect(getShift(db, sa.id)?.employeeId).toBe(a.id); // NOT exchanged
    expect(getSwapRequest(db, req.request.id)?.status).toBe("expired");
  });

  it("decline and cancel are role-gated", () => {
    const { db, a, b, sa, sb } = setup();
    const r1 = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
    if (!r1.ok) throw new Error("s");
    expect(declineSwap(db, r1.request.id, a.id).ok).toBe(false); // initiator can't decline
    expect(declineSwap(db, r1.request.id, b.id).ok).toBe(true);
    const r2 = createSwap(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toShiftId: sb.id });
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
