import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, type Employee } from "../db/schema";

export function createEmployee(
  db: Db,
  data: { displayName: string; inviteToken?: string; isAdmin?: boolean },
): Employee {
  return db.insert(employees).values(data).returning().all()[0]!;
}

/**
 * Claims a roster row with an invite token, returning it — or null if the token
 * matches nothing usable.
 *
 * `isActive` is part of "usable": an archived row is one the system has been told
 * to stop counting, and a leftover invite for it used to link happily and answer
 * «Ты в системе ✅», after which `/api/auth` 403'd the person on their first tap.
 * A token that leads nowhere is better refused at the door.
 */
export function linkTelegramAccount(
  db: Db,
  inviteToken: string,
  telegramUserId: number,
  tgUsername?: string,
  tgFirstName?: string,
): Employee | null {
  const rows = db
    .update(employees)
    .set({
      telegramUserId,
      tgUsername: tgUsername ?? null,
      tgFirstName: tgFirstName ?? null,
      inviteToken: null,
    })
    .where(and(eq(employees.inviteToken, inviteToken), eq(employees.isActive, true)))
    .returning()
    .all();
  return rows[0] ?? null;
}

/**
 * Keeps the Telegram side of a linked row current. People rename themselves, and
 * `tgFirstName` is what the bot says hello with — a stale one is a wrong greeting
 * forever. Called on every auth, so it writes only when something actually
 * changed rather than touching the row on each request.
 */
export function rememberTelegramProfile(
  db: Db,
  employeeId: number,
  profile: { tgUsername?: string | null; tgFirstName?: string | null },
): void {
  const current = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!current) return;
  const tgUsername = profile.tgUsername ?? null;
  const tgFirstName = profile.tgFirstName ?? null;
  if (current.tgUsername === tgUsername && current.tgFirstName === tgFirstName) return;
  db.update(employees).set({ tgUsername, tgFirstName }).where(eq(employees.id, employeeId)).run();
}

/** The one setting a worker owns about themselves: shift reminders on or off. */
export function setRemindersEnabled(db: Db, employeeId: number, enabled: boolean): Employee | undefined {
  return db
    .update(employees)
    .set({ remindersEnabled: enabled })
    .where(eq(employees.id, employeeId))
    .returning()
    .all()[0];
}

export function getByTelegramId(db: Db, telegramUserId: number): Employee | undefined {
  return db.select().from(employees).where(eq(employees.telegramUserId, telegramUserId)).get();
}

/** Nulls last, then the admin's order, then id — so the sort is total and stable
 *  even while somebody has no number yet. */
const ROSTER_ORDER = [
  sql`case when ${employees.rosterOrder} is null then 1 else 0 end`,
  employees.rosterOrder,
  employees.id,
] as const;

/** Every active worker, in the order the admin arranged them. The order is the
 *  same everywhere — the schedule grid, the workers screen and the CSV export all
 *  read one list, so a person sits in the same row wherever you look. */
export function listActive(db: Db): Employee[] {
  return db.select().from(employees).where(eq(employees.isActive, true)).orderBy(...ROSTER_ORDER).all();
}

export function listActiveInRosterOrder(db: Db): Employee[] {
  return listActive(db);
}

/**
 * Moves one worker to `position` (1-based, as the admin sees it) and renumbers
 * everyone so the list stays 0..n-1 with no gaps and no duplicates.
 *
 * Renumbering the whole list rather than nudging neighbours is what keeps this
 * safe to repeat: however the numbers got skewed before — an import, a restore,
 * a half-finished edit — one move puts the whole column back in order.
 *
 * Returns the new ordering, or null if that worker isn't in it.
 */
export function reorderEmployee(db: Db, id: number, position: number): Employee[] | null {
  return db.transaction((tx) => {
    const current = tx.select().from(employees).where(eq(employees.isActive, true)).orderBy(...ROSTER_ORDER).all();
    const from = current.findIndex((employee) => employee.id === id);
    if (from === -1) return null;

    const target = Math.min(Math.max(Math.trunc(position), 1), current.length) - 1;
    const [moved] = current.splice(from, 1);
    current.splice(target, 0, moved!);

    current.forEach((employee, index) => {
      if (employee.rosterOrder !== index) {
        tx.update(employees).set({ rosterOrder: index }).where(eq(employees.id, employee.id)).run();
      }
    });
    return current.map((employee, index) => ({ ...employee, rosterOrder: index }));
  });
}

/** Sets or clears a worker's birthday. `null` clears it — nobody is obliged to give one. */
export function setBirthDate(db: Db, id: number, birthDate: string | null): Employee | undefined {
  return db.update(employees).set({ birthDate }).where(eq(employees.id, id)).returning().all()[0];
}

/**
 * Sets or clears how this person is addressed. `null` hands the decision back to
 * `addressOf`'s fallback chain rather than storing an empty greeting.
 */
export function setPreferredName(db: Db, id: number, preferredName: string | null): Employee | undefined {
  return db.update(employees).set({ preferredName }).where(eq(employees.id, id)).returning().all()[0];
}

export function createAdminEmployee(
  db: Db,
  data: { telegramUserId: number; tgUsername?: string; tgFirstName?: string; displayName: string },
): Employee {
  return db
    .insert(employees)
    .values({
      telegramUserId: data.telegramUserId,
      tgUsername: data.tgUsername ?? null,
      tgFirstName: data.tgFirstName ?? null,
      displayName: data.displayName,
      isAdmin: true,
    })
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
  return db.select().from(employees).where(eq(employees.isActive, false)).orderBy(...ROSTER_ORDER).all();
}

/**
 * The whole roster for an admin screen: active in the admin's order, then the
 * archive underneath.
 *
 * Both consoles draw their «Архив» tab by filtering this list for `isActive ===
 * false`, so serving only the active ones made that tab permanently empty and
 * «Восстановить» impossible to reach. Everything that must not see an archived
 * person — the grid, the pools, the balance — filters `isActive` itself.
 */
export function listForAdmin(db: Db): Employee[] {
  return [...listActive(db), ...listArchived(db)];
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
