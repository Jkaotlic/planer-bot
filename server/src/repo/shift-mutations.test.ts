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
  it("deletes the shift and its referencing swap/reminder rows", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" });
    const b = createEmployee(db, { displayName: "Игорь" });
    const s1 = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: a.id });
    const s2 = createShift(db, { date: "2026-07-11", start: "11:00", end: "20:00", employeeId: b.id });
    // rows that FK-reference s1
    db.insert(swapRequests).values({ fromEmployeeId: a.id, fromShiftId: s1.id, toEmployeeId: b.id, toShiftId: s2.id }).run();
    db.insert(reminderLog).values({ shiftId: s1.id, kind: "evening_before" }).run();

    expect(deleteShift(db, s1.id)).toBe(true);
    expect(getShift(db, s1.id)).toBeUndefined();          // shift gone
    expect(getShift(db, s2.id)?.id).toBe(s2.id);          // other shift kept
    expect(db.select().from(swapRequests).all().length).toBe(0);  // referencing swap removed
    expect(db.select().from(reminderLog).all().length).toBe(0);   // reminder removed
  });

  it("returns false for an unknown id", () => {
    expect(deleteShift(makeTestDb(), 999)).toBe(false);
  });
});
