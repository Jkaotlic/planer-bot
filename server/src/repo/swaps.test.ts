import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift, listShiftsByEmployee } from "./shifts";
import { createSwapRequest, getSwapRequest, setSwapStatus, listSwapsForEmployee } from "./swaps";

function pair(db = makeTestDb()) {
  const a = createEmployee(db, { displayName: "Аня" });
  const b = createEmployee(db, { displayName: "Игорь" });
  const sa = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
  const sb = createShift(db, { date: "2026-07-11", start: "11:00", end: "20:00", employeeId: b.id });
  return { db, a, b, sa, sb };
}

describe("swap repos", () => {
  it("creates, reads, and status-transitions a request", () => {
    const { db, a, b, sa, sb } = pair();
    const req = createSwapRequest(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toEmployeeId: b.id, toShiftId: sb.id, message: "выручи" });
    expect(req.status).toBe("pending");
    expect(getSwapRequest(db, req.id)?.message).toBe("выручи");
    setSwapStatus(db, req.id, "declined");
    const after = getSwapRequest(db, req.id)!;
    expect(after.status).toBe("declined");
    expect(after.resolvedAt).toBeInstanceOf(Date);
  });

  it("lists requests where the employee is on either side", () => {
    const { db, a, b, sa, sb } = pair();
    createSwapRequest(db, { fromEmployeeId: a.id, fromShiftId: sa.id, toEmployeeId: b.id, toShiftId: sb.id });
    expect(listSwapsForEmployee(db, a.id).length).toBe(1);
    expect(listSwapsForEmployee(db, b.id).length).toBe(1);
  });

  it("lists all of an employee's shifts", () => {
    const { db, a, sa } = pair();
    expect(listShiftsByEmployee(db, a.id).map((s) => s.id)).toEqual([sa.id]);
  });
});
