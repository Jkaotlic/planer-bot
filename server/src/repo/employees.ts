import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, type Employee } from "../db/schema";

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

export function listActiveInRosterOrder(db: Db): Employee[] {
  return db
    .select()
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(
      sql`case when ${employees.rosterOrder} is null then 1 else 0 end`,
      employees.rosterOrder,
      employees.id,
    )
    .all();
}

export function createAdminEmployee(
  db: Db,
  data: { telegramUserId: number; tgUsername?: string; displayName: string },
): Employee {
  return db
    .insert(employees)
    .values({ telegramUserId: data.telegramUserId, tgUsername: data.tgUsername ?? null, displayName: data.displayName, isAdmin: true })
    .returning()
    .all()[0]!;
}

export function getEmployeeById(db: Db, id: number): Employee | undefined {
  return db.select().from(employees).where(eq(employees.id, id)).get();
}

export function archiveEmployee(db: Db, id: number, fromDate: string): Employee | undefined {
  db.update(shifts)
    .set({ employeeId: null })
    .where(and(eq(shifts.employeeId, id), gte(shifts.date, fromDate)))
    .run();
  return db
    .update(employees)
    .set({ isActive: false, archivedAt: new Date() })
    .where(eq(employees.id, id))
    .returning()
    .all()[0];
}

export function restoreEmployee(db: Db, id: number): Employee | undefined {
  return db
    .update(employees)
    .set({ isActive: true, archivedAt: null })
    .where(eq(employees.id, id))
    .returning()
    .all()[0];
}

export function listArchived(db: Db): Employee[] {
  return db.select().from(employees).where(eq(employees.isActive, false)).all();
}

export function setEmployeeAdmin(db: Db, id: number, isAdmin: boolean): Employee | undefined {
  return db.update(employees).set({ isAdmin }).where(eq(employees.id, id)).returning().all()[0];
}

export function renameEmployee(db: Db, id: number, displayName: string): Employee | undefined {
  return db.update(employees).set({ displayName }).where(eq(employees.id, id)).returning().all()[0];
}

export function setInviteToken(db: Db, id: number, inviteToken: string): Employee | undefined {
  return db.update(employees).set({ inviteToken }).where(eq(employees.id, id)).returning().all()[0];
}

/** Count of active admins — used to block removing the last one (lockout guard). */
export function countActiveAdmins(db: Db): number {
  return db.select().from(employees).where(and(eq(employees.isAdmin, true), eq(employees.isActive, true))).all().length;
}

export function listAdmins(db: Db): Employee[] {
  return db
    .select()
    .from(employees)
    .where(and(eq(employees.isAdmin, true), eq(employees.isActive, true), isNotNull(employees.telegramUserId)))
    .all();
}
