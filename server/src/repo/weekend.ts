import { and, eq, gte, isNull, lte, like, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  shifts,
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

/**
 * An already-open slot with exactly these details, or `null`.
 *
 * Guards against a double-click on «Опубликовать»: the button posts a broadcast
 * to the whole team, and unlike most creates in this app (where a duplicate row
 * is harmless clutter), a second identical slot means a second «Нужен человек на
 * выходной» DM to everyone who linked Telegram. Exact match only — `location`/
 * `note` differing means the admin meant something else by it, not a repeat tap.
 */
export function findOpenSlotLike(
  db: Db,
  data: { date: string; start: string; end: string; title?: string | null; location?: string | null },
): VacantSlot | null {
  return (
    db
      .select()
      .from(vacantSlots)
      .where(
        and(
          eq(vacantSlots.status, "open"),
          eq(vacantSlots.date, data.date),
          eq(vacantSlots.start, data.start),
          eq(vacantSlots.end, data.end),
          data.title != null ? eq(vacantSlots.title, data.title) : isNull(vacantSlots.title),
          data.location != null ? eq(vacantSlots.location, data.location) : isNull(vacantSlots.location),
        ),
      )
      .get() ?? null
  );
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

/** Every assignment on a slot — a slot can need several people. */
export function listAssignmentsForSlot(db: Db, slotId: number): WeekendAssignment[] {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.slotId, slotId)).all();
}

export function getAssignment(db: Db, id: number): WeekendAssignment | undefined {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.id, id)).get();
}

export function findAssignment(db: Db, slotId: number, employeeId: number): WeekendAssignment | undefined {
  return db
    .select()
    .from(weekendAssignments)
    .where(and(eq(weekendAssignments.slotId, slotId), eq(weekendAssignments.employeeId, employeeId)))
    .get();
}

export function deleteAssignment(db: Db, id: number): void {
  db.delete(weekendAssignments).where(eq(weekendAssignments.id, id)).run();
}

/** Puts a previously declined assignment back into "offered" with a fresh shift link. */
export function reofferAssignment(db: Db, id: number, shiftId: number | null): void {
  db.update(weekendAssignments)
    .set({ status: "offered", shiftId, confirmedAt: null })
    .where(eq(weekendAssignments.id, id))
    .run();
}

export function setAssignmentShift(db: Db, id: number, shiftId: number | null): void {
  db.update(weekendAssignments).set({ shiftId }).where(eq(weekendAssignments.id, id)).run();
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

/**
 * Confirmed weekend work as the schedule actually holds it: one row per
 * assignment that still has an entry, dated and timed by that entry.
 *
 * The schedule is the source of truth for pay (his decision, 2026-07-30). It used
 * to be the slot's date plus `weekendAssignments.hours` — a snapshot taken at
 * assign time — so an admin shortening or moving the entry changed the schedule
 * and nothing else, and the payroll export quietly kept paying the old figure.
 *
 * An assignment whose entry an admin deleted produces no row: the work is not in
 * the schedule. That deletion is a journalled `entry_deleted`, so it is findable.
 */
export function listConfirmedWorkInRange(
  db: Db,
  from: string,
  to: string,
): { employeeId: number; date: string; start: string | null; end: string | null }[] {
  return db
    .select({
      employeeId: weekendAssignments.employeeId,
      date: shifts.date,
      start: shifts.start,
      end: shifts.end,
    })
    .from(weekendAssignments)
    .innerJoin(shifts, eq(weekendAssignments.shiftId, shifts.id))
    .where(and(eq(weekendAssignments.status, "confirmed"), gte(shifts.date, from), lte(shifts.date, to)))
    .all();
}

/**
 * How many weekend slots this worker raised their hand for and did not get.
 * Being passed over repeatedly earns priority next time, so a keen volunteer
 * isn't skipped forever.
 *
 * Counted per *slot*, not per rival assignment: a slot needing three people
 * produces three assignment rows, and joining against «somebody else got it»
 * scored each of its own winners as passed over twice — sharing a slot earned
 * priority instead of spending it.
 *
 * Having any assignment on the slot ends the question, `declined` included: they
 * were asked and said no, which is the opposite of being skipped.
 */
export function countPassedOver(db: Db, employeeId: number): number {
  const mine = db
    .select({ slotId: weekendAssignments.slotId })
    .from(weekendAssignments)
    .where(eq(weekendAssignments.employeeId, employeeId))
    .all()
    .map((r) => r.slotId);
  return db
    .selectDistinct({ slotId: slotInterest.slotId })
    .from(slotInterest)
    .innerJoin(weekendAssignments, eq(weekendAssignments.slotId, slotInterest.slotId))
    .where(and(
      eq(slotInterest.employeeId, employeeId),
      mine.length > 0 ? notInArray(slotInterest.slotId, mine) : undefined,
    ))
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
