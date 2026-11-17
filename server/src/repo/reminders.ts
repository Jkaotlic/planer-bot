import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

/**
 * Имя пометки о посланном чек-листе в `reminder_log`, рядом с `evening_before`.
 *
 * Один ряд смены может иметь несколько списков, переходить к другому дежурному
 * или покрывать несколько дат. Доставка старому получателю не заменяет письмо
 * новому. Тот же ключ читает сводка администратора.
 */
export function checklistKind(checklistId: number, day: string, employeeId: number): string {
  return `duty_checklist:${checklistId}@${day}#${employeeId}`;
}

/**
 * Две служебные пометки рядом с основной — отдельными видами, а не ею самой:
 * по основной админский экран отвечает «сегодня уже ушло», а это неправда ни
 * про ушедший без текста файл, ни про отказ Telegram.
 *
 * Файл уходит в тике тем же проходом, что и текст (см. `runChecklistTick`), и
 * ту же дневную пометку — иначе на многодневной записи он ушёл бы один раз за
 * весь диапазон, пока текст уже приходит каждый день.
 */
export function checklistDocKind(checklistId: number, day: string, employeeId: number): string {
  return `duty_checklist_doc:${checklistId}@${day}#${employeeId}`;
}

export function checklistUndeliverableKind(checklistId: number, day: string, employeeId: number): string {
  return `duty_checklist_undeliverable:${checklistId}@${day}#${employeeId}`;
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

/**
 * Пометка вечернего напоминания — на пару «запись + получатель».
 *
 * Пока пометка висела на одной записи, обмен в 21:00 переносил смену на
 * Игоря, а тик считал, что напоминание «уже ушло», — Игорь не получал ничего.
 */
export function eveningReminderKind(employeeId: number): string {
  return `evening_before:${employeeId}`;
}

/**
 * Уходило ли вечернее напоминание этому человеку про эту запись.
 *
 * Старая пометка без получателя (`evening_before`) тоже считается: иначе
 * выкатка посреди вечера разослала бы напоминание второй раз всем, кому оно уже
 * ушло. Её цена — прежнее поведение ровно на один вечер после выкатки.
 */
export function hasEveningReminder(db: Db, shiftId: number, employeeId: number): boolean {
  return hasReminder(db, shiftId, eveningReminderKind(employeeId)) || hasReminder(db, shiftId, "evening_before");
}
