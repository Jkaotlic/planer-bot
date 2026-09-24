import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

/**
 * Имя пометки о посланном чек-листе в `reminder_log`, рядом с `evening_before`.
 *
 * С id списка внутри, а не общее `duty_checklist`: с 2026-09-01 у смены бывает
 * несколько списков, и общая пометка означала бы «что-то одно уже уходило» —
 * второй список молчал бы всегда. Мигрировано в `0033`.
 *
 * Живёт рядом с таблицей, а не у тика: по этой же пометке админский экран
 * отвечает «сегодня уже ушло», и тянуть ради строки бота в HTTP-слой незачем.
 */
export function checklistKind(checklistId: number): string {
  return `duty_checklist:${checklistId}`;
}

/**
 * Две служебные пометки рядом с основной — отдельными видами, а не ею самой:
 * по основной админский экран отвечает «сегодня уже ушло», а это неправда ни
 * про ушедший без текста файл, ни про отказ Telegram.
 */
export function checklistDocKind(checklistId: number): string {
  return `duty_checklist_doc:${checklistId}`;
}

export function checklistUndeliverableKind(checklistId: number): string {
  return `duty_checklist_undeliverable:${checklistId}`;
}

export function hasReminder(db: Db, shiftId: number, kind: string): boolean {
  return reminderSentAt(db, shiftId, kind) !== null;
}

/** Когда напоминание ушло, или `null` — если не уходило. */
export function reminderSentAt(db: Db, shiftId: number, kind: string): Date | null {
  const row = db
    .select({ sentAt: reminderLog.sentAt })
    .from(reminderLog)
    .where(and(eq(reminderLog.shiftId, shiftId), eq(reminderLog.kind, kind)))
    .get();
  return row?.sentAt ?? null;
}

export function addReminder(db: Db, shiftId: number, kind: string): void {
  db.insert(reminderLog).values({ shiftId, kind }).run();
}
