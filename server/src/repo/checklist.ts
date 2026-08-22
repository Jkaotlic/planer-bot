import { and, asc, eq, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { checklistItems, checklistMarks, type ChecklistItem, type ChecklistMark } from "../db/schema";

/** Пункты, которые сегодня показывают человеку, в заданном админом порядке. */
export function activeChecklistItems(db: Db): ChecklistItem[] {
  return db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.isActive, true))
    .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.id))
    .all();
}

/** Новый пункт встаёт в конец списка — админ переставит, если ему нужно иначе. */
export function createChecklistItem(db: Db, title: string): ChecklistItem {
  const last = db.select({ n: max(checklistItems.sortOrder) }).from(checklistItems).get()?.n ?? -1;
  return db.insert(checklistItems).values({ title, sortOrder: last + 1 }).returning().all()[0]!;
}

/** Правит подпись и/или пояснение. `undefined` — «не трогать это поле». */
export function updateChecklistItem(
  db: Db,
  id: number,
  patch: { title?: string; note?: string | null },
): ChecklistItem | undefined {
  const set: { title?: string; note?: string | null } = {};
  if (patch.title !== undefined) set.title = patch.title;
  // Пустое пояснение стирается: «задано пустым» и «не задано» — одно и то же,
  // а пустая строка потом рисовала бы под пунктом пустой отступ.
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  if (Object.keys(set).length === 0) return db.select().from(checklistItems).where(eq(checklistItems.id, id)).get();
  return db.update(checklistItems).set(set).where(eq(checklistItems.id, id)).returning().all()[0];
}

/**
 * Убрать пункт — погасить, а не удалить.
 *
 * На него ссылаются вчерашние отметки (внешний ключ), и даже без ключа история
 * «что проверяли в августе» — ровно то, ради чего чек-лист заводят.
 */
export function deactivateChecklistItem(db: Db, id: number): void {
  db.update(checklistItems).set({ isActive: false }).where(eq(checklistItems.id, id)).run();
}

/** Ставит пункт на нужное место, сдвигая остальные. Порядок пишется целиком —
 *  список короткий, а частичный сдвиг оставлял бы дыры в нумерации. */
export function reorderChecklistItem(db: Db, id: number, toIndex: number): void {
  const items = activeChecklistItems(db);
  const from = items.findIndex((item) => item.id === id);
  if (from === -1) return;
  const [moved] = items.splice(from, 1);
  if (!moved) return;
  items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, moved);
  db.transaction(() => {
    items.forEach((item, index) => {
      db.update(checklistItems).set({ sortOrder: index }).where(eq(checklistItems.id, item.id)).run();
    });
  });
}

export interface MarkInput {
  date: string;
  employeeId: number;
  itemId: number;
  done: boolean;
}

/**
 * Ставит или снимает отметку.
 *
 * Идемпотентно: повтор ничего не меняет. `onConflictDoNothing` вместо «сначала
 * прочитать, потом вставить» — между чтением и вставкой помещается второй тап
 * с того же телефона, и уникальный индекс тогда роняет запрос вместо того, чтобы
 * промолчать.
 */
export function setMark(db: Db, input: MarkInput): void {
  const { date, employeeId, itemId, done } = input;
  if (done) {
    db.insert(checklistMarks).values({ date, employeeId, itemId }).onConflictDoNothing().run();
    return;
  }
  db.delete(checklistMarks)
    .where(and(eq(checklistMarks.date, date), eq(checklistMarks.employeeId, employeeId), eq(checklistMarks.itemId, itemId)))
    .run();
}

/** Что этот человек отметил в этот день. */
export function listMarksFor(db: Db, date: string, employeeId: number): ChecklistMark[] {
  return db
    .select()
    .from(checklistMarks)
    .where(and(eq(checklistMarks.date, date), eq(checklistMarks.employeeId, employeeId)))
    .all();
}

/** Отметки за день по всем — для сводки «кто прошёл» в консоли. */
export function listMarksOnDate(db: Db, date: string): ChecklistMark[] {
  return db.select().from(checklistMarks).where(eq(checklistMarks.date, date)).all();
}
