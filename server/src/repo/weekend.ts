import { and, count, eq, gte, inArray, isNull, lte, like, notInArray, or, type SQL } from "drizzle-orm";
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

/**
 * Слоты для админа: открытые и закрытые («набрали») — закрытый виден до своей
 * даты, чтобы админ видел, кто выходит, но без «Назначить».
 */
export function listAdminSlots(db: Db, fromDate: string): VacantSlot[] {
  return db
    .select()
    .from(vacantSlots)
    .where(and(inArray(vacantSlots.status, ["open", "closed"]), gte(vacantSlots.date, fromDate)))
    .orderBy(vacantSlots.date)
    .all();
}

export function getVacantSlot(db: Db, id: number): VacantSlot | undefined {
  return db.select().from(vacantSlots).where(eq(vacantSlots.id, id)).get();
}

export function setSlotStatus(db: Db, id: number, status: "open" | "assigned" | "closed"): void {
  db.update(vacantSlots).set({ status }).where(eq(vacantSlots.id, id)).run();
}

/**
 * Сколько выходных смен стоит на дате: записи «Работа в выходной» плюс ОТКРЫТЫЕ
 * слоты выходного. Для предупреждения, когда день отметили рабочим (I5 аудита
 * 2026-10-15).
 *
 * Слоты — только открытые: у занятого его люди уже стоят записями, и счёт
 * назвал бы одну смену дважды; закрытый ничего не ждёт. Записи — тоже только
 * той же даты: «Работа в выходной» диапазоном не пишется (`entrySpanError`).
 */
export function countWeekendLeftovers(db: Db, date: string): number {
  const entries = db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.date, date), eq(shifts.category, "weekend_work")))
    .all().length;
  const slots = db
    .select({ id: vacantSlots.id })
    .from(vacantSlots)
    .where(and(eq(vacantSlots.date, date), eq(vacantSlots.status, "open")))
    .all().length;
  return entries + slots;
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

/** Снять «Хочу». Возвращает, был ли отклик: нет — ничего не произошло. */
export function removeInterest(db: Db, slotId: number, employeeId: number): boolean {
  return (
    db.delete(slotInterest)
      .where(and(eq(slotInterest.slotId, slotId), eq(slotInterest.employeeId, employeeId)))
      .run().changes > 0
  );
}

/** Снять все отклики человека на слоты с `fromDate` — при архивации. */
export function removeAllInterestOf(db: Db, employeeId: number, fromDate: string): void {
  const slotIds = db.select({ id: vacantSlots.id }).from(vacantSlots).where(gte(vacantSlots.date, fromDate)).all().map((r) => r.id);
  if (slotIds.length === 0) return;
  db.delete(slotInterest)
    .where(and(eq(slotInterest.employeeId, employeeId), inArray(slotInterest.slotId, slotIds)))
    .run();
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

/** Every assignment on a slot — a slot can need several people. */
export function listAssignmentsForSlot(db: Db, slotId: number): WeekendAssignment[] {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.slotId, slotId)).all();
}

export function getAssignment(db: Db, id: number): WeekendAssignment | undefined {
  return db.select().from(weekendAssignments).where(eq(weekendAssignments.id, id)).get();
}

const linkedWeekendWork = and(
  eq(shifts.id, weekendAssignments.shiftId),
  eq(shifts.employeeId, weekendAssignments.employeeId),
  eq(shifts.category, "weekend_work"),
);

/**
 * The schedule can be edited independently. An offered assignment only applies
 * to the time and worker who were asked. For a confirmed assignment, schedule
 * edits to the date or hours already flow through to payroll.
 */
function liveAssignmentsQuery(db: Db, filter: SQL | undefined) {
  return db.select({ assignment: weekendAssignments, slot: vacantSlots })
    .from(weekendAssignments)
    .innerJoin(vacantSlots, eq(vacantSlots.id, weekendAssignments.slotId))
    .innerJoin(shifts, linkedWeekendWork)
    .where(and(
      filter,
      or(
        eq(weekendAssignments.status, "confirmed"),
        and(
          eq(weekendAssignments.status, "offered"),
          eq(shifts.date, vacantSlots.date),
          eq(shifts.start, vacantSlots.start),
          eq(shifts.end, vacantSlots.end),
        ),
      ),
    ));
}

export function getLiveAssignment(db: Db, id: number): WeekendAssignment | undefined {
  return liveAssignmentsQuery(db, eq(weekendAssignments.id, id)).get()?.assignment;
}

export function listLiveAssignmentsForSlot(db: Db, slotId: number): WeekendAssignment[] {
  return liveAssignmentsQuery(db, eq(weekendAssignments.slotId, slotId)).all().map(({ assignment }) => assignment);
}

export function listLiveOffersForEmployee(db: Db, employeeId: number): { assignment: WeekendAssignment; slot: VacantSlot }[] {
  return liveAssignmentsQuery(db, eq(weekendAssignments.employeeId, employeeId)).all();
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
 * Confirmation belongs to the worker who accepted. If the entry was removed,
 * reassigned or changed to another category, that confirmation produces no row.
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
    .innerJoin(shifts, linkedWeekendWork)
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
    .select({ total: count() })
    .from(weekendAssignments)
    .innerJoin(shifts, linkedWeekendWork)
    .where(and(
      eq(weekendAssignments.status, "confirmed"),
      eq(weekendAssignments.employeeId, employeeId),
      like(shifts.date, `${monthPrefix}%`),
    ))
    .get()?.total ?? 0;
}

/** Назначения, на которые человек ещё не ответил, у слотов в [from, to]. */
export function listUnansweredAssignments(
  db: Db, from: string, to: string,
): { assignment: WeekendAssignment; slot: VacantSlot }[] {
  return liveAssignmentsQuery(db, and(
    eq(weekendAssignments.status, "offered"),
    gte(vacantSlots.date, from),
    lte(vacantSlots.date, to),
  )).all();
}
