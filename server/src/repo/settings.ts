import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { REMINDER_HOUR_DEFAULT } from "@planer/shared";
import { appSettings, type AppSetting } from "../db/schema";

/**
 * Team-wide toggles: `swaps_locked` and `reminder_hour`.
 *
 * A missing row means «default», never «broken»: the migration seeds nothing, so
 * a database that predates this feature reads as «swaps are open» — which is how
 * it behaved before the feature existed.
 */
const SWAPS_LOCKED = "swaps_locked";
const REMINDER_HOUR = "reminder_hour";

/**
 * The database, or a transaction opened on it.
 *
 * `setSwapLock` (Task 3) writes this flag and cancels the affected swap requests
 * in ONE transaction — both must land or neither — so it has to hand the
 * transaction handle to this writer. Drizzle types that handle differently from
 * `Db`, and a `tx as Db` cast at the call site would be a lie that compiles.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function isSwapsLocked(db: Db): boolean {
  return readSetting(db, SWAPS_LOCKED)?.value === "1";
}

/** The row behind the toggle — for «кто и когда закрыл» on the settings screen. */
export function readSetting(db: Db, key: string): AppSetting | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get();
}

export function setSwapsLocked(db: DbOrTx, locked: boolean, actorEmployeeId: number): void {
  db.insert(appSettings)
    .values({ key: SWAPS_LOCKED, value: locked ? "1" : "0", updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() })
    // A switch, not a log: pressing «закрыть» twice must leave one row, or the
    // reader's answer would depend on which row it happened to see first.
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: locked ? "1" : "0", updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() },
    })
    .run();
}

export function swapsLockSetting(db: Db): AppSetting | undefined {
  return readSetting(db, SWAPS_LOCKED);
}

/**
 * Во сколько накануне уходят напоминания о завтрашней смене.
 *
 * Строки нет — 20:00, тот час, что был захардкожен до этой настройки: база, не
 * знавшая настройки, ведёт себя ровно как вчера. Значение проверено на записи
 * (`validateReminderHour`), поэтому читатель ему верит.
 */
export function reminderHour(db: Db): string {
  return readSetting(db, REMINDER_HOUR)?.value ?? REMINDER_HOUR_DEFAULT;
}

export function setReminderHour(db: Db, value: string, actorEmployeeId: number): void {
  db.insert(appSettings)
    .values({ key: REMINDER_HOUR, value, updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedByEmployeeId: actorEmployeeId, updatedAt: new Date() },
    })
    .run();
}

export function reminderHourSetting(db: Db): AppSetting | undefined {
  return readSetting(db, REMINDER_HOUR);
}
