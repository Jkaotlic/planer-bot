import { and, count, desc, gte, inArray, lte } from "drizzle-orm";
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

export interface AuditQuery {
  /** Only these event types; empty or absent means every type. */
  types?: readonly string[];
  /** Inclusive YYYY-MM-DD bounds on when the event happened. */
  from?: string;
  to?: string;
  limit: number;
  offset?: number;
}

export interface AuditPage {
  rows: AuditLog[];
  /** How many match the filter in total — what the screen needs to page through. */
  total: number;
  /** Every type present in the log, so the filter can offer only real options. */
  availableTypes: string[];
}

/**
 * The «кто когда что менял» history: filtered, counted and paged.
 *
 * A date bound covers that whole day, and `to` is inclusive — which is what a
 * person means by «по 5 августа», and not what a naive `< to` would give them.
 */
export function queryAudit(db: Db, query: AuditQuery): AuditPage {
  const filters = [];
  if (query.types && query.types.length > 0) filters.push(inArray(auditLog.type, [...query.types]));
  if (query.from) filters.push(gte(auditLog.createdAt, new Date(`${query.from}T00:00:00Z`)));
  if (query.to) filters.push(lte(auditLog.createdAt, new Date(`${query.to}T23:59:59Z`)));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(query.limit)
    .offset(query.offset ?? 0)
    .all();

  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  const availableTypes = db
    .selectDistinct({ type: auditLog.type })
    .from(auditLog)
    .all()
    .map((row) => row.type)
    .sort();

  return { rows, total, availableTypes };
}

export function listRecentAudit(db: Db, limit: number): AuditLog[] {
  // createdAt has one-second resolution, so two events in the same second tie. `id`
  // breaks the tie by actual write order — otherwise the feed shows them shuffled.
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit).all();
}
