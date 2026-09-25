import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

/**
 * День в ключе пометки — только у многодневной записи. У неё один ряд `shifts`
 * на весь диапазон, и ключ без дня означал бы «чек-лист уже уходил» с первого
 * дня до последнего: неделя дежурства получала инструкцию один раз в
 * понедельник и молчала до воскресенья. Однодневные записи ключ не меняют:
 * тронь его всем — и в день выкатки сегодняшние чек-листы ушли бы второй раз
 * тем, кому уже ушли по старому ключу.
 */
export function checklistDayKey(shift: { date: string; endDate: string | null }, today: string): string | undefined {
  return shift.endDate != null && shift.endDate > shift.date ? today : undefined;
}

/**
 * Имя пометки о посланном чек-листе в `reminder_log`, рядом с `evening_before`.
 *
 * С id списка внутри, а не общее `duty_checklist`: с 2026-09-01 у смены бывает
 * несколько списков, и общая пометка означала бы «что-то одно уже уходило» —
 * второй список молчал бы всегда. Мигрировано в `0033`.
 *
 * Живёт рядом с таблицей, а не у тика: по этой же пометке админский экран
 * отвечает «сегодня уже ушло», и тянуть ради строки бота в HTTP-слой незачем.
 *
 * `day` — от `checklistDayKey`: без него ключ как раньше, с ним — свой на
 * каждый день многодневной записи.
 */
export function checklistKind(checklistId: number, day?: string): string {
  return day ? `duty_checklist:${checklistId}@${day}` : `duty_checklist:${checklistId}`;
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
export function checklistDocKind(checklistId: number, day?: string): string {
  return day ? `duty_checklist_doc:${checklistId}@${day}` : `duty_checklist_doc:${checklistId}`;
}

export function checklistUndeliverableKind(checklistId: number, day?: string): string {
  return day ? `duty_checklist_undeliverable:${checklistId}@${day}` : `duty_checklist_undeliverable:${checklistId}`;
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
