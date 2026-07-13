import { and, eq, gte, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, swapRequests, reminderLog, type Shift, type NewShift } from "../db/schema";

export function createShift(db: Db, data: NewShift): Shift {
  return db.insert(shifts).values(data).returning().all()[0]!;
}

export function getShift(db: Db, id: number): Shift | undefined {
  return db.select().from(shifts).where(eq(shifts.id, id)).get();
}

export function listShiftsInRange(db: Db, startDate: string, endDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(gte(shifts.date, startDate), lte(shifts.date, endDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}

export function listUpcomingForEmployee(db: Db, employeeId: number, fromDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), gte(shifts.date, fromDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}

export function updateShift(db: Db, id: number, patch: Partial<NewShift>): Shift | undefined {
  return db.update(shifts).set(patch).where(eq(shifts.id, id)).returning().all()[0];
}

export function deleteShift(db: Db, id: number): boolean {
  return db.transaction((tx) => {
    tx.delete(swapRequests).where(or(eq(swapRequests.fromShiftId, id), eq(swapRequests.toShiftId, id))).run();
    tx.delete(reminderLog).where(eq(reminderLog.shiftId, id)).run();
    return tx.delete(shifts).where(eq(shifts.id, id)).returning().all().length > 0;
  });
}

export function listShiftsByEmployee(db: Db, employeeId: number): Shift[] {
  return db.select().from(shifts).where(eq(shifts.employeeId, employeeId)).all();
}
