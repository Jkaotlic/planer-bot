import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift, getShift, updateShift, deleteShift } from "./shifts";
import { swapRequests, reminderLog } from "../db/schema";

describe("updateShift", () => {
  it("patches fields and bumps updatedAt", () => {
    const db = makeTestDb();
    const s = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00" });
    const updated = updateShift(db, s.id, { category: "vacation", start: null, end: null, endDate: "2026-07-20" });
    expect(updated?.category).toBe("vacation");
    expect(updated?.start).toBeNull();
    expect(updated?.endDate).toBe("2026-07-20");
  });

  it("returns undefined for an unknown id", () => {
    expect(updateShift(makeTestDb(), 999, { note: "x" })).toBeUndefined();
  });
});

describe("deleteShift (FK-safe cascade)", () => {
  /** Two workers with one shift each, plus a swap between them in `status`. */
  function pair(status: "pending" | "accepted") {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" });
    const b = createEmployee(db, { displayName: "Игорь" });
    const s1 = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
    const s2 = createShift(db, { date: "2026-07-11", start: "11:00", end: "20:00", employeeId: b.id });
    const swap = db.insert(swapRequests)
      .values({ fromEmployeeId: a.id, fromShiftId: s1.id, toEmployeeId: b.id, toShiftId: s2.id, status })
      .returning().all()[0]!;
    return { db, s1, s2, swap };
  }

  it("deletes the shift and its reminder rows", () => {
    const { db, s1, s2 } = pair("pending");
    db.insert(reminderLog).values({ shiftId: s1.id, kind: "evening_before" }).run();

    expect(deleteShift(db, s1.id).deleted).toBe(true);
    expect(getShift(db, s1.id)).toBeUndefined();          // shift gone
    expect(getShift(db, s2.id)?.id).toBe(s2.id);          // other shift kept
    expect(db.select().from(reminderLog).all().length).toBe(0);   // reminder removed
  });

  // The spec's state machine says «смена изменена/удалена → expired (уведомить обе
  // стороны)». Erasing the row instead makes the request vanish from both people's
  // archives with nobody told anything.
  it("expires a pending swap that hangs on the deleted shift instead of erasing it", () => {
    const { db, s1, swap } = pair("pending");

    const res = deleteShift(db, s1.id);
    expect(res.deleted).toBe(true);
    expect(res.expiredSwaps.map((r) => r.id)).toEqual([swap.id]);

    const rows = db.select().from(swapRequests).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("expired");
    expect(rows[0]!.fromShiftId).toBeNull();   // the shift it pointed at is gone
    expect(rows[0]!.resolvedAt).not.toBeNull();
  });

  it("keeps an already-accepted swap in history when one of its shifts is deleted", () => {
    const { db, s2, swap } = pair("accepted");

    const res = deleteShift(db, s2.id);
    expect(res.deleted).toBe(true);
    expect(res.expiredSwaps).toEqual([]);      // resolved history isn't re-resolved

    const rows = db.select().from(swapRequests).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(swap.id);
    expect(rows[0]!.status).toBe("accepted");  // still says it happened
    expect(rows[0]!.toShiftId).toBeNull();
  });

  it("returns deleted:false for an unknown id", () => {
    expect(deleteShift(makeTestDb(), 999).deleted).toBe(false);
  });
});
