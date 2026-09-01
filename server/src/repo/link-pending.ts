import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { collectionLinkPending } from "../db/schema";

/**
 * Ссылка, ждущая ответа «к какому сбору».
 *
 * Одна строка на админа: выбор делается следующим тапом, а не через час, и
 * новая присланная ссылка затирает прежнюю — это и есть «передумал».
 */
export function setLinkPending(db: Db, employeeId: number, url: string): void {
  db.insert(collectionLinkPending)
    .values({ employeeId, url })
    .onConflictDoUpdate({ target: collectionLinkPending.employeeId, set: { url, createdAt: new Date() } })
    .run();
}

export function linkPendingFor(db: Db, employeeId: number): string | null {
  return db.select().from(collectionLinkPending).where(eq(collectionLinkPending.employeeId, employeeId)).get()?.url ?? null;
}

export function clearLinkPending(db: Db, employeeId: number): void {
  db.delete(collectionLinkPending).where(eq(collectionLinkPending.employeeId, employeeId)).run();
}
