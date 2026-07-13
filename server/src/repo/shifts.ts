import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, type Shift, type NewShift } from "../db/schema";

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
