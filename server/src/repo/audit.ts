import { desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, type AuditLog } from "../db/schema";

/** Records one thing that happened, for the «кто когда что менял» feed. Never let a
 *  bookkeeping failure take down the action it describes — the write already
 *  succeeded by the time we get here. */
export function recordAudit(db: Db, type: string, actorEmployeeId: number | null, payload: unknown): void {
  try {
    db.insert(auditLog).values({ type, actorEmployeeId, payload }).run();
  } catch (err) {
    console.error(`failed to record audit "${type}":`, err instanceof Error ? err.message : err);
  }
}

export function listRecentAudit(db: Db, limit: number): AuditLog[] {
  // createdAt has one-second resolution, so two events in the same second tie. `id`
  // breaks the tie by actual write order — otherwise the feed shows them shuffled.
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit).all();
}
