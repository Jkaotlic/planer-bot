import { eq, inArray } from "drizzle-orm";
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
 * Те же строки, что `getTemplate` (снятые с использования включены), — для многих id
 * одним запросом: тик напоминаний смотрит вид смены у каждой записи дня, и запрос на
 * запись рос квадратом от команды.
 */
export function templatesByIds(db: Db, ids: Iterable<number | null>): Map<number, ShiftTemplate> {
  const unique = [...new Set(ids)].filter((id): id is number => id != null);
  if (unique.length === 0) return new Map();
  return new Map(db.select().from(shiftTemplates).where(inArray(shiftTemplates.id, unique)).all().map((t) => [t.id, t]));
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
