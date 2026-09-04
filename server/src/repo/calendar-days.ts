import { and, eq, gte, lte } from "drizzle-orm";
import { calendarFrom, type DayCalendar, type DayKind } from "@planer/shared";
import type { Db } from "../db/client";
import { calendarDays, type CalendarDay } from "../db/schema";

/** Календарь исключений на диапазон — то, что передаётся в `isDayOff`. */
export function loadCalendar(db: Db, from: string, to: string): DayCalendar {
  return calendarFrom(listCalendarDays(db, from, to));
}

export function listCalendarDays(db: Db, from: string, to: string): CalendarDay[] {
  return db
    .select()
    .from(calendarDays)
    .where(and(gte(calendarDays.date, from), lte(calendarDays.date, to)))
    .orderBy(calendarDays.date)
    .all();
}

export function listCalendarYear(db: Db, year: number): CalendarDay[] {
  return listCalendarDays(db, `${year}-01-01`, `${year}-12-31`);
}

/**
 * Год из источника целиком: снять свои прежние строки, положить новые.
 *
 * Только `source = 'auto'`: день, поставленный админом руками, — его решение,
 * и перечитанный календарь его не отменяет. Если на дату уже стоит ручная
 * строка, авто на неё не пишется — первичный ключ один, и побеждает человек.
 * Транзакция, потому что между «снял» и «положил» читатель увидел бы год без
 * праздников.
 */
export function replaceAutoYear(
  db: Db,
  year: number,
  days: readonly { date: string; kind: DayKind; note: string | null }[],
  when: Date,
): { added: number; removed: number } {
  return db.transaction((tx) => {
    const manual = new Set(
      tx
        .select({ date: calendarDays.date })
        .from(calendarDays)
        .where(and(gte(calendarDays.date, `${year}-01-01`), lte(calendarDays.date, `${year}-12-31`), eq(calendarDays.source, "manual")))
        .all()
        .map((row) => row.date),
    );
    const removed = tx
      .delete(calendarDays)
      .where(and(gte(calendarDays.date, `${year}-01-01`), lte(calendarDays.date, `${year}-12-31`), eq(calendarDays.source, "auto")))
      .run().changes;
    let added = 0;
    for (const day of days) {
      if (manual.has(day.date)) continue;
      tx.insert(calendarDays).values({ date: day.date, kind: day.kind, note: day.note, source: "auto", updatedAt: when }).run();
      added += 1;
    }
    return { added, removed };
  });
}

/** Ручная строка админа; `kind = null` убирает её (авто вернётся следующим обновлением). */
export function setManualDay(db: Db, date: string, kind: DayKind | null, note: string | null, when: Date): void {
  if (kind === null) {
    db.delete(calendarDays).where(eq(calendarDays.date, date)).run();
    return;
  }
  db.insert(calendarDays)
    .values({ date, kind, note, source: "manual", updatedAt: when })
    .onConflictDoUpdate({ target: calendarDays.date, set: { kind, note, source: "manual", updatedAt: when } })
    .run();
}
