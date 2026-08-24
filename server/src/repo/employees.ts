import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees, shifts, type Employee } from "../db/schema";
import type { DbOrTx } from "./settings";

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

/** Расшифровка букв под картинкой недели — вторая личная настройка человека. */
export function setWeekLegend(db: Db, employeeId: number, enabled: boolean): Employee | undefined {
  return db
    .update(employees)
    .set({ weekLegend: enabled })
    .where(eq(employees.id, employeeId))
    .returning()
    .all()[0];
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

/**
 * The two admin-set restriction flags. Both optional: they live on one card but
 * are flipped by separate gestures, so either may arrive alone.
 *
 * Takes `DbOrTx`, not `Db`: `PATCH /api/admin/employees/:id` writes this flag
 * and cancels the person's open swap requests as ONE fact — same reasoning as
 * `setSwapLock` — so it has to be callable with the caller's own transaction
 * handle.
 */
export function setEmployeeRestrictions(
  db: DbOrTx,
  id: number,
  patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean },
): Employee | undefined {
  return db.update(employees).set(patch).where(eq(employees.id, id)).returning().all()[0];
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

/**
 * Takes somebody off the roster: their future shifts go back to unassigned and
 * the row stops being active.
 *
 * One transaction, because half of it is a state nobody would ever look for — a
 * person still listed as active whose schedule quietly emptied, or an archived
 * person still standing in next week's grid.
 */
export function archiveEmployee(db: Db, id: number, fromDate: string): Employee | undefined {
  return db.transaction(() => {
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
  });
}

/**
 * Brings somebody back onto the roster, at the position their old number implies.
 *
 * That number was frozen while they were away and the active list was renumbered
 * around them, so by the time they return somebody else may well be holding it —
 * two people on one number, with the order between them decided by row id. So the
 * whole active column is renumbered on the way back, exactly as `reorderEmployee`
 * does: sorted by the number they had, ties by id, then handed 0..n-1.
 */
export function restoreEmployee(db: Db, id: number): Employee | undefined {
  return db.transaction((tx) => {
    const restored = tx
      .update(employees)
      .set({ isActive: true, archivedAt: null })
      .where(eq(employees.id, id))
      .returning()
      .all()[0];
    if (!restored) return undefined;
    tx.select().from(employees).where(eq(employees.isActive, true)).orderBy(...ROSTER_ORDER).all()
      .forEach((employee, index) => {
        if (employee.rosterOrder !== index) {
          tx.update(employees).set({ rosterOrder: index }).where(eq(employees.id, employee.id)).run();
        }
      });
    return tx.select().from(employees).where(eq(employees.id, id)).get();
  });
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

/**
 * Роль наблюдателя. Отдельно от `setEmployeeRestrictions` намеренно: та пишет
 * галочки, которые ставит админ по случаю, а это — утверждение о человеке,
 * из которого поведение следует само. Исключения при этом НЕ переписываются:
 * снятие роли должно вернуть человека туда, где он был до неё.
 *
 * Берёт `DbOrTx`, не `Db` — `PATCH /api/admin/employees/:id` пишет эту роль в
 * той же транзакции, что и остальные правки карточки, той же причиной, что и
 * у `setEmployeeRestrictions`.
 */
export function setEmployeeObserver(db: DbOrTx, id: number, isObserver: boolean): Employee | undefined {
  return db.update(employees).set({ isObserver }).where(eq(employees.id, id)).returning().all()[0];
}

/** Тумблер «веду свой график сам» — его ставит сам наблюдатель, не админ. */
export function setSelfScheduleEnabled(db: Db, id: number, enabled: boolean): Employee | undefined {
  return db.update(employees).set({ selfScheduleEnabled: enabled }).where(eq(employees.id, id)).returning().all()[0];
}

/** ФИО as it is compared for «этот человек уже есть»: trimmed, case-folded. */
export function normalizeFullName(displayName: string): string {
  return displayName.trim().toLocaleLowerCase("ru");
}

/**
 * The active worker already using this ФИО, if there is one — `exceptId` is the row
 * being edited, so re-saving your own name is not a clash.
 *
 * The roster CSV is keyed by ФИО and nothing else. Two active namesakes make the
 * export write two identical rows and the import then refuse the whole file with «в
 * CSV повторяется ФИО» — the график-файлом feature dies and the message blames the
 * file. He says the team has no namesakes; this is that rule, written down.
 *
 * Archived rows don't count: the export writes no row for them, so they cannot
 * collide with anything. Restoring one is checked at the door instead.
 *
 * Compared in JS, not SQL: SQLite's `lower()` is ASCII-only, so «ИВАНОВ» and
 * «иванов» would come out different there.
 */
export function findActiveByDisplayName(db: Db, displayName: string, exceptId?: number): Employee | undefined {
  const wanted = normalizeFullName(displayName);
  return listActive(db).find((e) => e.id !== exceptId && normalizeFullName(e.displayName) === wanted);
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
