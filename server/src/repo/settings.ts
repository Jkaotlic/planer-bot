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
const COVERAGE_ADVICE_SENT_ON = "coverage_advice_sent_on";
const HOLIDAYS_AUTO = "holidays_auto";
const HOLIDAYS_CHECKED_ON = "holidays_checked_on";
const HOLIDAYS_STATE = "holidays_state";

/**
 * Записать настройку. Одна форма записи на все ключи: `onConflictDoUpdate`,
 * скопированный в четвёртый раз, — это четвёртый шанс написать его иначе.
 * `actor` пуст, когда пишет тик, а не человек.
 */
function putSetting(db: Db, key: string, value: string, actor: number | null): void {
  db.insert(appSettings)
    .values({ key, value, updatedByEmployeeId: actor, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedByEmployeeId: actor, updatedAt: new Date() } })
    .run();
}

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
  putSetting(db, REMINDER_HOUR, value, actorEmployeeId);
}

export function reminderHourSetting(db: Db): AppSetting | undefined {
  return readSetting(db, REMINDER_HOUR);
}

/**
 * В какой день вечерний совет про пробелы графика уже уходил.
 *
 * Тик крутится каждые пять минут весь вечер, а совет — одно письмо в день.
 * Отметка здесь, а не в `reminders`: та таблица привязана к смене, а у совета
 * смены нет — он про то, чего в графике НЕТ. `updatedByEmployeeId` пуст: писал
 * тик, а не человек.
 */
export function coverageAdviceSentOn(db: Db): string | null {
  return readSetting(db, COVERAGE_ADVICE_SENT_ON)?.value ?? null;
}

export function markCoverageAdviceSent(db: Db, date: string): void {
  putSetting(db, COVERAGE_ADVICE_SENT_ON, date, null);
}

/**
 * Брать ли праздники из производственного календаря.
 *
 * Строки нет — включено: база, не знавшая рычага, ведёт себя так, как задумано
 * по умолчанию. Выключенный означает «бот таблицу не трогает вовсе»; ручные
 * отметки админа работают в обоих положениях.
 */
export function isHolidaysAuto(db: Db): boolean {
  return readSetting(db, HOLIDAYS_AUTO)?.value !== "0";
}

export function setHolidaysAuto(db: Db, on: boolean, actorEmployeeId: number): void {
  putSetting(db, HOLIDAYS_AUTO, on ? "1" : "0", actorEmployeeId);
}

export function holidaysAutoSetting(db: Db): AppSetting | undefined {
  return readSetting(db, HOLIDAYS_AUTO);
}

/** В какой день тик уже проверял календарь: он крутится каждые пять минут. */
export function holidaysCheckedOn(db: Db): string | null {
  return readSetting(db, HOLIDAYS_CHECKED_ON)?.value ?? null;
}

export function markHolidaysChecked(db: Db, date: string): void {
  putSetting(db, HOLIDAYS_CHECKED_ON, date, null);
}

/** Что известно про загруженный год: когда, откуда и сколько дней. */
export interface HolidayYearState {
  refreshedAt: string;
  source: "xmlcalendar" | "bundled";
  days: number;
}

/**
 * Состояние по годам, ключ — год строкой.
 *
 * JSON в одной строке, а не таблица: читателей двое (тик и экран настроек),
 * записей — по одной на год, и `holiday_years` ради этого была бы таблицей,
 * которую никто никогда не спросит иначе как целиком.
 */
export function holidaysState(db: Db): Record<string, HolidayYearState> {
  const raw = readSetting(db, HOLIDAYS_STATE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, HolidayYearState>) : {};
  } catch {
    // Строку пишет только код, но испорченная не должна валить тик, который
    // без неё просто перечитает год заново.
    return {};
  }
}

export function setHolidayYearState(db: Db, year: number, state: HolidayYearState): void {
  putSetting(db, HOLIDAYS_STATE, JSON.stringify({ ...holidaysState(db), [String(year)]: state }), null);
}
