import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminderLog } from "../db/schema";

export function hasReminder(db: Db, shiftId: number, kind: string): boolean {
  return db
    .select({ id: reminderLog.id })
    .from(reminderLog)
    .where(and(eq(reminderLog.shiftId, shiftId), eq(reminderLog.kind, kind)))
    .get() !== undefined;
}

export function addReminder(db: Db, shiftId: number, kind: string): void {
  db.insert(reminderLog).values({ shiftId, kind }).run();
}
