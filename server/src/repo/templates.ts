import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { shiftTemplates, type ShiftTemplate } from "../db/schema";

export function listActiveTemplates(db: Db): ShiftTemplate[] {
  return db
    .select()
    .from(shiftTemplates)
    .where(eq(shiftTemplates.isActive, true))
    .orderBy(shiftTemplates.sortOrder)
    .all();
}

export function getTemplate(db: Db, id: number): ShiftTemplate | undefined {
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.id, id)).get();
}

/**
 * Норма покрытия одной строкой «Пн..Вс».
 *
 * Проверку делает вызывающий: сюда приходит уже разобранное и снова свёрнутое
 * значение (`serializeCoverage`), потому что колонка — обычный TEXT и SQLite на
 * ней ничего не стережёт.
 */
export function setCoverage(db: Db, templateId: number, coverage: string): void {
  db.update(shiftTemplates).set({ coverage }).where(eq(shiftTemplates.id, templateId)).run();
}

/**
 * Напоминание вида смены: слать ли и каким текстом.
 *
 * Пустой текст сюда не доходит — маршрут превращает его в `null`. Разница
 * существенная: `null` значит «стандартная формулировка по типу смены», а
 * пустая строка означала бы письмо без слов.
 */
export function setReminder(
  db: Db,
  templateId: number,
  reminder: { sendReminder: boolean; reminderText: string | null },
): void {
  db.update(shiftTemplates).set(reminder).where(eq(shiftTemplates.id, templateId)).run();
}
