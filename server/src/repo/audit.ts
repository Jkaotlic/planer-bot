import { desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, type AuditLog } from "../db/schema";

export function listRecentAudit(db: Db, limit: number): AuditLog[] {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit).all();
}
