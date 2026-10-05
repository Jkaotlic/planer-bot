import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { handoverDeclines, handovers, shifts, type Handover, type NewHandover } from "../db/schema";

export function createHandover(db: Db, data: NewHandover): Handover {
  return db.insert(handovers).values(data).returning().all()[0]!;
}

export function getHandover(db: Db, id: number): Handover | undefined {
  return db.select().from(handovers).where(eq(handovers.id, id)).get();
}

/**
 * The ones the tick still has to look at.
 *
 * `fanned` counts as live: the fan-out is an open offer, and it stays open even
 * after the admins have been told — somebody can still take the shift an hour
 * before it starts. Resolved rows are history and the tick walks past them.
 */
export function listLiveHandovers(db: Db): Handover[] {
  return db
    .select()
    .from(handovers)
    .where(inArray(handovers.status, ["offered", "fanned"]))
    .orderBy(asc(handovers.id))
    .all();
}

/** Every handover one «больничный» spawned — a multi-day one spawns several. */
export function listHandoversForEntry(db: Db, sickEntryId: number): Handover[] {
  return db.select().from(handovers).where(eq(handovers.sickEntryId, sickEntryId)).orderBy(asc(handovers.id)).all();
}

export function updateHandover(db: Db, id: number, patch: Partial<NewHandover>): Handover | undefined {
  return db.update(handovers).set(patch).where(eq(handovers.id, id)).returning().get();
}

/**
 * A repeated refusal is a no-op, not an error.
 *
 * The fan-out writes to a dozen people and any of them may tap twice — a throw
 * here would abort a broadcast halfway through, leaving half the team told and
 * the other half not, with nothing saying which half.
 */
export function addDecline(db: Db, handoverId: number, employeeId: number): void {
  db.insert(handoverDeclines).values({ handoverId, employeeId }).onConflictDoNothing().run();
}

/** Who already said «не могу» — the fan-out skips them, the letter names them. */
export function listDeclines(db: Db, handoverId: number): number[] {
  return db
    .select({ employeeId: handoverDeclines.employeeId })
    .from(handoverDeclines)
    .where(eq(handoverDeclines.handoverId, handoverId))
    .orderBy(asc(handoverDeclines.id))
    .all()
    .map((row) => row.employeeId);
}

/**
 * A worker's hand-overs still waiting for them to pick a colleague: offered to nobody,
 * not fanned, not closed, on a shift dated `fromDate` or later. Oldest shift first and
 * capped — the process also serves the bot's polling. The cap is generous on purpose: the
 * caller still drops void and started ones, and a tight cap here would let such stale rows
 * crowd live drafts out of the answer.
 */
export function listOpenDrafts(db: Db, employeeId: number, fromDate: string, limit = 100): Handover[] {
  return db
    .select({ handover: handovers })
    .from(handovers)
    .innerJoin(shifts, eq(handovers.shiftId, shifts.id))
    .where(
      and(
        eq(handovers.fromEmployeeId, employeeId),
        eq(handovers.status, "offered"),
        isNull(handovers.offeredToEmployeeId),
        gte(shifts.date, fromDate),
      ),
    )
    .orderBy(asc(shifts.date), asc(handovers.id))
    .limit(limit)
    .all()
    .map((row) => row.handover);
}
