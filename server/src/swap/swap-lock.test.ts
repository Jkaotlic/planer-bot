import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { createSwapRequest, getSwapRequest, setSwapStatus } from "../repo/swaps";
import { isSwapsLocked } from "../repo/settings";
import { setSwapLock, cancelSwapsForEmployee } from "./swap-lock";

function setup() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня Смирнова" });
  const igor = createEmployee(db, { displayName: "Игорь Петров" });
  const mark = createEmployee(db, { displayName: "Марк Волков" });
  const anyaShift = createShift(db, { date: "2026-08-13", start: "09:00", end: "18:00", employeeId: anya.id });
  const igorShift = createShift(db, { date: "2026-08-13", start: "12:00", end: "21:00", employeeId: igor.id });
  const markShift = createShift(db, { date: "2026-08-14", start: "09:00", end: "18:00", employeeId: mark.id });
  return { db, anya, igor, mark, anyaShift, igorShift, markShift };
}

describe("setSwapLock", () => {
  it("locks, cancels every pending request, and reports them", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const cancelled = setSwapLock(db, true, igor.id);

    expect(isSwapsLocked(db)).toBe(true);
    expect(getSwapRequest(db, request.id)?.status).toBe("cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      requestId: request.id,
      fromEmployeeId: anya.id,
      fromName: "Аня Смирнова",
      toEmployeeId: igor.id,
      toName: "Игорь Петров",
    });
  });

  // Settled requests are history. Rewriting them would make the archive lie about
  // what happened, and would notify people about a trade that finished days ago.
  it("leaves already-resolved requests alone", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    setSwapStatus(db, request.id, "declined");

    const cancelled = setSwapLock(db, true, igor.id);

    expect(cancelled).toEqual([]);
    expect(getSwapRequest(db, request.id)?.status).toBe("declined");
  });

  it("unlocking cancels nothing and revives nothing", () => {
    const { db, anya, igor, anyaShift, igorShift } = setup();
    const request = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    setSwapLock(db, true, igor.id);
    const onUnlock = setSwapLock(db, false, igor.id);
    expect(isSwapsLocked(db)).toBe(false);
    expect(onUnlock).toEqual([]);
    expect(getSwapRequest(db, request.id)?.status).toBe("cancelled");
  });
});

describe("cancelSwapsForEmployee", () => {
  it("cancels the person's requests in both directions and leaves other people's alone", () => {
    const { db, anya, igor, mark, anyaShift, igorShift, markShift } = setup();
    const outgoing = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    const incoming = createSwapRequest(db, {
      fromEmployeeId: mark.id, fromShiftId: markShift.id,
      toEmployeeId: anya.id, toShiftId: anyaShift.id,
    });
    const untouched = createSwapRequest(db, {
      fromEmployeeId: igor.id, fromShiftId: igorShift.id,
      toEmployeeId: mark.id, toShiftId: markShift.id,
    });

    const cancelled = cancelSwapsForEmployee(db, anya.id);

    expect(cancelled.map((p) => p.requestId).sort()).toEqual([outgoing.id, incoming.id].sort());
    expect(getSwapRequest(db, outgoing.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, incoming.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, untouched.id)?.status).toBe("pending");
  });
});
