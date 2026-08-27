import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

/**
 * Имя вида чек-листного напоминания в `reminder_log`, рядом с `evening_before`.
 *
 * Живёт рядом с таблицей, а не у тика: по этой же пометке админский экран
 * отвечает «сегодня уже ушло», и тянуть ради строки бота в HTTP-слой незачем.
 */
export const CHECKLIST_KIND = "duty_checklist";

export function hasReminder(db: Db, shiftId: number, kind: string): boolean {
  return db
    .select({ id: reminderLog.id })
    .from(reminderLog)
    .where(and(eq(reminderLog.shiftId, shiftId), eq(reminderLog.kind, kind)))
    .get() !== undefined;
}

export function addReminder(db: Db, shiftId: number, kind: string): void {
  db.insert(reminderLog).values({ shiftId, kind }).run();
}
