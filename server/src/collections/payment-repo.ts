import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { collectionPayments } from "../db/schema";

/**
 * Чтение и запись отметок о сдаче — и больше ничего.
 *
 * Отдельный файл нужен, чтобы `collection-service` мог трогать отметки, не
 * импортируя `payment-service`: тот сам берёт отсюда `recipientsOf`, и импорт
 * в обратную сторону замкнул бы круг. Этот модуль не зависит ни от кого,
 * поэтому импортировать его можно откуда угодно.
 */

/** Отметки одного сбора. */
export function marksOf(db: Db, collectionId: number) {
  return db
    .select()
    .from(collectionPayments)
    .where(eq(collectionPayments.collectionId, collectionId))
    .all();
}

/** Отметки сразу нескольких сборов — список работника грузится одним запросом. */
export function marksOfMany(db: Db, collectionIds: number[]) {
  if (collectionIds.length === 0) return [];
  return db
    .select()
    .from(collectionPayments)
    .where(inArray(collectionPayments.collectionId, collectionIds))
    .all();
}

export function addMark(db: Db, collectionId: number, employeeId: number, markedBy: number): void {
  // `onConflictDoNothing` вместо «проверить и вставить»: двойной тап по медленной
  // сети приходит двумя запросами, и защищать от него должен уникальный индекс,
  // а не порядок строк в коде.
  db.insert(collectionPayments)
    .values({ collectionId, employeeId, markedBy })
    .onConflictDoNothing()
    .run();
}

export function removeMark(db: Db, collectionId: number, employeeId: number): void {
  db.delete(collectionPayments)
    .where(
      and(
        eq(collectionPayments.collectionId, collectionId),
        eq(collectionPayments.employeeId, employeeId),
      ),
    )
    .run();
}

export function removeMarksOf(db: Db, collectionId: number): void {
  db.delete(collectionPayments).where(eq(collectionPayments.collectionId, collectionId)).run();
}
