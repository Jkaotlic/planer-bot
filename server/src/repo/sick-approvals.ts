import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shifts, sickLeaveApprovalMessages, type Shift } from "../db/schema";
import type { SickSpan } from "@planer/shared";

/**
 * Pending again: a fresh request clears any earlier approver, because the dates it approved changed.
 * `approved` is the span an admin already said yes to when this request is an EXTENSION of it;
 * null for a plain request. It is stored so a reject can give the row back instead of deleting it.
 */
export function markApprovalRequested(db: Db, id: number, at: Date, approved: SickSpan | null = null): Shift | undefined {
  return db
    .update(shifts)
    .set({
      approvalRequestedAt: at,
      // An extension keeps whoever approved the rest: a withdrawn or rejected extension gives the row back
      // as it was, and «Уже подтвердил(а) …» must keep naming the person who really said yes.
      ...(approved ? {} : { approvedByEmployeeId: null }),
      approvedDate: approved?.date ?? null,
      approvedEndDate: approved?.endDate ?? null,
      // A new round is a new question: «передача запущена без ОК» belonged to the old one.
      handoverForcedAt: null,
    })
    .where(and(eq(shifts.id, id), eq(shifts.category, "sick_leave")))
    .returning()
    .get();
}

/**
 * The race guard for «ОК» and «Отклонить». One conditional UPDATE: SQLite runs it
 * atomically and this process has one connection, so of two admins pressing in the
 * same second exactly one gets the row back. Not inside a transaction with what
 * follows on purpose — `startHandovers` awaits Telegram, and better-sqlite3
 * transactions are synchronous. `approvedBy` undefined keeps the stored approver (an extension
 * going back to the state it had before the request).
 */
export function claimPendingSickLeave(db: Db, id: number, approvedBy?: number | null): Shift | undefined {
  return db
    .update(shifts)
    .set({ approvalRequestedAt: null, ...(approvedBy === undefined ? {} : { approvedByEmployeeId: approvedBy }), approvedDate: null, approvedEndDate: null })
    .where(and(eq(shifts.id, id), eq(shifts.category, "sick_leave"), isNotNull(shifts.approvalRequestedAt)))
    .returning()
    .get();
}

/** Keep the stored approved span equal to what the worker still wants of it (null: none left). */
export function setApprovedSpan(db: Db, id: number, span: SickSpan | null): Shift | undefined {
  return db
    .update(shifts)
    .set({ approvedDate: span?.date ?? null, approvedEndDate: span?.endDate ?? null })
    .where(eq(shifts.id, id))
    .returning()
    .get();
}

/** A rejected extension: the row goes back to the span that was approved before it. */
export function restoreApprovedSpan(db: Db, id: number, span: SickSpan): void {
  db.update(shifts).set({ date: span.date, endDate: span.endDate }).where(eq(shifts.id, id)).run();
}

/**
 * What the reads report for a sick leave: `pending` only while it waits, and the approved
 * span only when what waits is an extension. Keys are absent otherwise — old bundles ignore them.
 */
export function pendingMarks(shift: Shift): { pending?: true; approvedSpan?: SickSpan } {
  if (shift.category !== "sick_leave" || shift.approvalRequestedAt == null) return {};
  return shift.approvedDate != null
    ? { pending: true, approvedSpan: { date: shift.approvedDate, endDate: shift.approvedEndDate } }
    : { pending: true };
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

/**
 * «На подтверждение»: newest requests first, capped — one process also serves the bot's polling.
 * Newest, not oldest dates: a stale backdated request nobody decides would otherwise sit at the
 * front forever and, past the cap, push every fresh request out of the lists and the badge.
 */
export function listPendingSickLeaves(db: Db, limit = 100): Shift[] {
  return db
    .select()
    .from(shifts)
    .where(and(isNotNull(shifts.approvalRequestedAt), eq(shifts.category, "sick_leave")))
    .orderBy(desc(shifts.approvalRequestedAt), desc(shifts.id))
    .limit(limit)
    .all();
}

/**
 * The query itself, exposed so a test can EXPLAIN exactly what runs. The `+` before the date
 * columns is a planner hint, not arithmetic: on a real database most rows are in the past, so
 * `date <= horizon` looks selective to the planner and it walks `shift_date` instead of the
 * handful of pending rows. A unary plus makes the date predicates unusable for that index, so
 * the partial index `shift_pending_approval` (a few rows) is the only way in.
 */
export function pendingWithinQuery(db: Db, today: string, horizon: string) {
  return db
    .select()
    .from(shifts)
    .where(
      and(
        isNotNull(shifts.approvalRequestedAt),
        eq(shifts.category, "sick_leave"),
        lte(sql`+${shifts.date}`, horizon),
        gte(sql`coalesce(${shifts.endDate}, +${shifts.date})`, today),
      ),
    )
    .limit(100);
}

/** Pending sick leaves whose span touches [today, horizon] — the urgent tick's working set. */
export function listPendingSickLeavesWithin(db: Db, today: string, horizon: string): Shift[] {
  return pendingWithinQuery(db, today, horizon).all();
}

/** First forced hand-over wins: a later tick handing over the next day keeps the original mark. */
export function markHandoverForced(db: Db, id: number, at: Date): void {
  db.update(shifts).set({ handoverForcedAt: at }).where(and(eq(shifts.id, id), isNull(shifts.handoverForcedAt))).run();
}
