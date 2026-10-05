import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, sickLeaveApprovalMessages, type Shift } from "../db/schema";

/** Pending again: a fresh request clears any earlier approver, because the dates it approved changed. */
export function markApprovalRequested(db: Db, id: number, at: Date): Shift | undefined {
  return db
    .update(shifts)
    .set({ approvalRequestedAt: at, approvedByEmployeeId: null })
    .where(and(eq(shifts.id, id), eq(shifts.category, "sick_leave")))
    .returning()
    .get();
}

/**
 * The race guard for «ОК» and «Отклонить». One conditional UPDATE: SQLite runs it
 * atomically and this process has one connection, so of two admins pressing in the
 * same second exactly one gets the row back. Not inside a transaction with what
 * follows on purpose — `startHandovers` awaits Telegram, and better-sqlite3
 * transactions are synchronous.
 */
export function claimPendingSickLeave(db: Db, id: number, approvedBy: number | null): Shift | undefined {
  return db
    .update(shifts)
    .set({ approvalRequestedAt: null, approvedByEmployeeId: approvedBy })
    .where(and(eq(shifts.id, id), eq(shifts.category, "sick_leave"), isNotNull(shifts.approvalRequestedAt)))
    .returning()
    .get();
}

export function addApprovalMessage(db: Db, shiftId: number, chatId: number, messageId: number): void {
  db.insert(sickLeaveApprovalMessages).values({ shiftId, chatId, messageId }).onConflictDoNothing().run();
}

export function listApprovalMessages(db: Db, shiftId: number): { chatId: number; messageId: number }[] {
  return db
    .select({ chatId: sickLeaveApprovalMessages.chatId, messageId: sickLeaveApprovalMessages.messageId })
    .from(sickLeaveApprovalMessages)
    .where(eq(sickLeaveApprovalMessages.shiftId, shiftId))
    .all();
}

export function deleteApprovalMessages(db: Db, shiftId: number): void {
  db.delete(sickLeaveApprovalMessages).where(eq(sickLeaveApprovalMessages.shiftId, shiftId)).run();
}

/** «На подтверждение»: oldest dates first, capped — one process also serves the bot's polling. */
export function listPendingSickLeaves(db: Db, limit = 100): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(isNotNull(shifts.approvalRequestedAt), eq(shifts.category, "sick_leave")))
    .orderBy(asc(shifts.date), asc(shifts.id))
    .limit(limit)
    .all();
}

/** Pending sick leaves whose span touches [today, horizon] — the urgent tick's working set. */
export function listPendingSickLeavesWithin(db: Db, today: string, horizon: string): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(
      and(
        isNotNull(shifts.approvalRequestedAt),
        eq(shifts.category, "sick_leave"),
        lte(shifts.date, horizon),
        gte(sql`coalesce(${shifts.endDate}, ${shifts.date})`, today),
      ),
    )
    .limit(100)
    .all();
}

/** First forced hand-over wins: a later tick handing over the next day keeps the original mark. */
export function markHandoverForced(db: Db, id: number, at: Date): void {
  db.update(shifts).set({ handoverForcedAt: at }).where(and(eq(shifts.id, id), isNull(shifts.handoverForcedAt))).run();
}
