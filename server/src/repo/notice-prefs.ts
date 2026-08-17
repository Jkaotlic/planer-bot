import { and, eq } from "drizzle-orm";
import type { AdminNoticeKind } from "@planer/shared";
import type { Db } from "../db/client";
import { notificationMutes } from "../db/schema";

/** Выключен ли у этого человека этот вид. Отсутствие строки = включено. */
export function isNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind): boolean {
  return (
    db
      .select()
      .from(notificationMutes)
      .where(and(eq(notificationMutes.employeeId, employeeId), eq(notificationMutes.kind, kind)))
      .get() != null
  );
}

/** Выключить или включить обратно. Идемпотентно в обе стороны — эту ручку дёргают
 *  и с экрана, и кнопкой под самим уведомлением, и повторное нажатие не должно
 *  ни падать, ни заводить вторую строку. */
export function setNoticeMuted(db: Db, employeeId: number, kind: AdminNoticeKind, muted: boolean): void {
  if (!muted) {
    db.delete(notificationMutes)
      .where(and(eq(notificationMutes.employeeId, employeeId), eq(notificationMutes.kind, kind)))
      .run();
    return;
  }
  db.insert(notificationMutes).values({ employeeId, kind }).onConflictDoNothing().run();
}

export function listMutedKinds(db: Db, employeeId: number): AdminNoticeKind[] {
  return db
    .select()
    .from(notificationMutes)
    .where(eq(notificationMutes.employeeId, employeeId))
    .all()
    .map((row) => row.kind);
}
