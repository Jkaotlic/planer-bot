import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, type Employee } from "../db/schema";

export function createEmployee(
  db: Db,
  data: { displayName: string; inviteToken?: string; isAdmin?: boolean },
): Employee {
  return db.insert(employees).values(data).returning().all()[0]!;
}

export function linkTelegramAccount(
  db: Db,
  inviteToken: string,
  telegramUserId: number,
  tgUsername?: string,
): Employee | null {
  const rows = db
    .update(employees)
    .set({ telegramUserId, tgUsername: tgUsername ?? null, inviteToken: null })
    .where(eq(employees.inviteToken, inviteToken))
    .returning()
    .all();
  return rows[0] ?? null;
}

export function getByTelegramId(db: Db, telegramUserId: number): Employee | undefined {
  return db.select().from(employees).where(eq(employees.telegramUserId, telegramUserId)).get();
}

export function listActive(db: Db): Employee[] {
  return db.select().from(employees).where(eq(employees.isActive, true)).all();
}
