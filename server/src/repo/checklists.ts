import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { checklists, shiftTemplates, type Checklist } from "../db/schema";

/**
 * Чек-листы как сущности: у каждого своё имя, своя инструкция и свои пункты.
 *
 * Именованные, а не один на систему: у дежурного с семи и у дежурного с восьми
 * проверки разные. «Скоп смен» задаётся с другой стороны — тем, какие виды смен
 * ссылаются на этот чек-лист (`shift_templates.checklist_id`), и один чек-лист
 * спокойно обслуживает несколько видов.
 */
export function listChecklists(db: Db): Checklist[] {
  return db.select().from(checklists).orderBy(asc(checklists.id)).all();
}

export function getChecklist(db: Db, id: number): Checklist | undefined {
  return db.select().from(checklists).where(eq(checklists.id, id)).get();
}

export function createChecklist(db: Db, name: string): Checklist {
  return db.insert(checklists).values({ name }).returning().all()[0]!;
}

/** Правит имя и/или инструкцию. `undefined` — «не трогать это поле». */
export function updateChecklist(
  db: Db,
  id: number,
  patch: {
    name?: string;
    note?: string | null;
    docUrl?: string | null;
    docFileId?: string | null;
    docName?: string | null;
    docPath?: string | null;
  },
): Checklist | undefined {
  const set: Record<string, string | null> = {};
  // Пустая строка стирает: «задано пустым» и «не задано» — одно и то же, а
  // пустое пояснение рисовало бы под списком пустой отступ.
  const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.note !== undefined) set.note = clean(patch.note);
  if (patch.docUrl !== undefined) set.docUrl = clean(patch.docUrl);
  if (patch.docFileId !== undefined) set.docFileId = clean(patch.docFileId);
  if (patch.docName !== undefined) set.docName = clean(patch.docName);
  if (patch.docPath !== undefined) set.docPath = clean(patch.docPath);
  if (Object.keys(set).length === 0) return getChecklist(db, id);
  return db.update(checklists).set(set).where(eq(checklists.id, id)).returning().all()[0];
}

/**
 * Удаляет чек-лист вместе со ссылками на него у видов смен.
 *
 * Пункты при этом остаются — на них ссылаются отметки, и «что проверяли в
 * августе» из базы исчезать не должно. Они просто становятся ничьими и в
 * списках больше не появляются: активные пункты всегда читаются по
 * `checklistId`.
 */
export function deleteChecklist(db: Db, id: number): void {
  db.transaction(() => {
    db.update(shiftTemplates).set({ checklistId: null }).where(eq(shiftTemplates.checklistId, id)).run();
    db.delete(checklists).where(eq(checklists.id, id)).run();
  });
}

/** Привязывает вид смены к чек-листу или снимает привязку (`null`). */
export function setTemplateChecklist(db: Db, templateId: number, checklistId: number | null): void {
  db.update(shiftTemplates).set({ checklistId }).where(eq(shiftTemplates.id, templateId)).run();
}
