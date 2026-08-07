import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, swapRequests, reminderLog, type Shift, type NewShift, type SwapRequest, weekendAssignments } from "../db/schema";

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

/** Shifts whose span [date, endDate ?? date] touches [from, to] — includes a
 *  multi-day absence that began before `from`, which listShiftsInRange misses. */
export function listShiftsOverlapping(db: Db, from: string, to: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(lte(shifts.date, to), gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, from)))
    .orderBy(shifts.date, shifts.start)
    .all();
}

/**
 * Записи работника, которые ещё не кончились на `fromDate`.
 *
 * Граница по концу записи, а не по началу: отпуск с 1 по 20 июля идёт прямо
 * сейчас, если смотреть седьмого, и человек должен видеть его во «Ближайших
 * сменах». Тот же `coalesce`, что и в `listShiftsOverlapping` двумя функциями выше.
 */
export function listUpcomingForEmployee(db: Db, employeeId: number, fromDate: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, fromDate)))
    .orderBy(shifts.date, shifts.start)
    .all();
}

export function updateShift(db: Db, id: number, patch: Partial<NewShift>): Shift | undefined {
  return db.update(shifts).set(patch).where(eq(shifts.id, id)).returning().all()[0];
}

/**
 * Removes an entry, taking the rows that point at it with it — except the swap
 * requests, which outlive it.
 *
 * A swap request is a record of something two people agreed (or were about to
 * agree) between themselves; the admin deleting one of the two shifts doesn't
 * make that conversation not have happened. So a still-`pending` request becomes
 * `expired` — the state the spec's machine reserves for «смена изменена/удалена»
 * — and anything already resolved keeps its status. Either way the pointer at the
 * vanished shift is nulled, which is the whole reason the column is nullable.
 *
 * The expired ones come back to the caller, which is the only place that can tell
 * both sides their swap is off — this function has no bot and shouldn't get one.
 */
export function deleteShift(db: Db, id: number): { deleted: boolean; expiredSwaps: SwapRequest[] } {
  return db.transaction((tx) => {
    const touching = or(eq(swapRequests.fromShiftId, id), eq(swapRequests.toShiftId, id));
    const expiredSwaps = tx
      .update(swapRequests)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(and(eq(swapRequests.status, "pending"), touching))
      .returning()
      .all();
    tx.update(swapRequests).set({ fromShiftId: null }).where(eq(swapRequests.fromShiftId, id)).run();
    tx.update(swapRequests).set({ toShiftId: null }).where(eq(swapRequests.toShiftId, id)).run();
    tx.delete(reminderLog).where(eq(reminderLog.shiftId, id)).run();
    // A weekend assignment points at the entry it created; drop the link (keeping the
    // assignment itself) or the delete trips the foreign key.
    tx.update(weekendAssignments).set({ shiftId: null }).where(eq(weekendAssignments.shiftId, id)).run();
    const deleted = tx.delete(shifts).where(eq(shifts.id, id)).returning().all().length > 0;
    return { deleted, expiredSwaps };
  });
}

export function listShiftsByEmployee(db: Db, employeeId: number): Shift[] {
  return db.select().from(shifts).where(eq(shifts.employeeId, employeeId)).all();
}

/** Unassigned, timed 'shift' slots in [from, to] — candidates for fair auto-distribution. */
export function listUnassignedShifts(db: Db, from: string, to: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(
      isNull(shifts.employeeId),
      eq(shifts.category, "shift"),
      isNotNull(shifts.start),
      isNotNull(shifts.end),
      gte(shifts.date, from),
      lte(shifts.date, to),
    ))
    .orderBy(shifts.date, shifts.start)
    .all();
}
