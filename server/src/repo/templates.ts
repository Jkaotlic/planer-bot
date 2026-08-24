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
