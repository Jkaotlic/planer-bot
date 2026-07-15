import { and, eq, gte, lte, like, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  vacantSlots,
  slotInterest,
  weekendAssignments,
  type VacantSlot,
  type WeekendAssignment,
} from "../db/schema";

export function createVacantSlot(
  db: Db,
  data: { date: string; start: string; end: string; title?: string | null; location?: string | null; note?: string | null },
): VacantSlot {
  return db.insert(vacantSlots).values(data).returning().all()[0]!;
}

export function listOpenSlots(db: Db, fromDate: string): VacantSlot[] {
  return db
    .select()
    .from(vacantSlots)
    .where(and(eq(vacantSlots.status, "open"), gte(vacantSlots.date, fromDate)))
    .orderBy(vacantSlots.date)
    .all();
}

export function getVacantSlot(db: Db, id: number): VacantSlot | undefined {
  return db.select().from(vacantSlots).where(eq(vacantSlots.id, id)).get();
}

export function setSlotStatus(db: Db, id: number, status: "open" | "assigned" | "closed"): void {
  db.update(vacantSlots).set({ status }).where(eq(vacantSlots.id, id)).run();
}

/** Idempotent: a double "Хочу" from the same worker on the same slot is harmless. */
export function addInterest(db: Db, slotId: number, employeeId: number): void {
  const existing = db
    .select({ id: slotInterest.id })
    .from(slotInterest)
    .where(and(eq(slotInterest.slotId, slotId), eq(slotInterest.employeeId, employeeId)))
    .get();
  if (existing) return;
  db.insert(slotInterest).values({ slotId, employeeId }).run();
}

export function listInterestedEmployeeIds(db: Db, slotId: number): number[] {
  return db
    .select({ employeeId: slotInterest.employeeId })
    .from(slotInterest)
    .where(eq(slotInterest.slotId, slotId))
    .all()
    .map((r) => r.employeeId);
}

export function listMyInterestSlotIds(db: Db, employeeId: number): number[] {
  return db
    .select({ slotId: slotInterest.slotId })
    .from(slotInterest)
    .where(eq(slotInterest.employeeId, employeeId))
    .all()
    .map((r) => r.slotId);
}

export function createAssignment(
  db: Db,
  data: { slotId: number; employeeId: number; hours: number },
): WeekendAssignment {
  return db.insert(weekendAssignments).values(data).returning().all()[0]!;
}

export function getAssignmentForSlot(db: Db, slotId: number): WeekendAssignment | undefined {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.slotId, slotId)).get();
}

export function confirmAssignment(db: Db, id: number, shiftId: number): void {
  db.update(weekendAssignments)
    .set({ status: "confirmed", confirmedAt: new Date(), shiftId })
    .where(eq(weekendAssignments.id, id))
    .run();
}

export function listAssignmentsForEmployee(db: Db, employeeId: number): WeekendAssignment[] {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.employeeId, employeeId)).all();
}

/** Confirmed assignments in a slot-date range. The caller resolves slot date+hours via the slot. */
export function listConfirmedInRange(db: Db, from: string, to: string): WeekendAssignment[] {
  return db
    .select({
      id: weekendAssignments.id,
      slotId: weekendAssignments.slotId,
      employeeId: weekendAssignments.employeeId,
      status: weekendAssignments.status,
      hours: weekendAssignments.hours,
      shiftId: weekendAssignments.shiftId,
      createdAt: weekendAssignments.createdAt,
      confirmedAt: weekendAssignments.confirmedAt,
    })
    .from(weekendAssignments)
    .innerJoin(vacantSlots, eq(weekendAssignments.slotId, vacantSlots.id))
    .where(and(eq(weekendAssignments.status, "confirmed"), gte(vacantSlots.date, from), lte(vacantSlots.date, to)))
    .all();
}

/**
 * How many times this worker raised their hand for a weekend slot that then went
 * to somebody else. Being passed over repeatedly earns priority next time, so a
 * keen volunteer isn't skipped forever.
 */
export function countPassedOver(db: Db, employeeId: number): number {
  return db
    .select({ slotId: slotInterest.slotId })
    .from(slotInterest)
    .innerJoin(weekendAssignments, eq(weekendAssignments.slotId, slotInterest.slotId))
    .where(and(eq(slotInterest.employeeId, employeeId), ne(weekendAssignments.employeeId, employeeId)))
    .all().length;
}

export function countConfirmedByEmployeeInMonth(db: Db, employeeId: number, monthPrefix: string): number {
  return db
    .select({ id: weekendAssignments.id })
    .from(weekendAssignments)
    .innerJoin(vacantSlots, eq(weekendAssignments.slotId, vacantSlots.id))
    .where(and(
      eq(weekendAssignments.status, "confirmed"),
      eq(weekendAssignments.employeeId, employeeId),
      like(vacantSlots.date, `${monthPrefix}%`),
    ))
    .all().length;
}
