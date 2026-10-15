import { and, eq, gte, lte } from "drizzle-orm";
import { calendarFrom, type DayCalendar, type DayKind } from "@planer/shared";
import type { Db } from "../db/client";
import { calendarDays, type CalendarDay } from "../db/schema";
import { BUNDLED_YEARS } from "../holidays/bundled";

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
 * и перечитанный календарь его не отменяет. На дату с ручной строкой авто не
 * вставляется — первичный ключ один, и побеждает человек, — но её `auto_*`
 * обновляются (и обнуляются, если даты в новом наборе нет): иначе снятие
 * отметки вернуло бы день к тому, что календарь говорил раньше, а не сейчас.
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
    const inYear = and(gte(calendarDays.date, `${year}-01-01`), lte(calendarDays.date, `${year}-12-31`));
    const manual = new Set(
      tx
        .select({ date: calendarDays.date })
        .from(calendarDays)
        .where(and(inYear, eq(calendarDays.source, "manual")))
        .all()
        .map((row) => row.date),
    );
    const removed = tx.delete(calendarDays).where(and(inYear, eq(calendarDays.source, "auto"))).run().changes;
    // Сначала обнулить у всех ручных: дата, которой нет в новом наборе, больше
    // не праздник по календарю, и снятие отметки не должно его воскресить.
    tx.update(calendarDays).set({ autoKind: null, autoNote: null }).where(and(inYear, eq(calendarDays.source, "manual"))).run();
    let added = 0;
    for (const day of days) {
      if (manual.has(day.date)) {
        tx.update(calendarDays).set({ autoKind: day.kind, autoNote: day.note }).where(eq(calendarDays.date, day.date)).run();
        continue;
      }
      tx.insert(calendarDays).values({ date: day.date, kind: day.kind, note: day.note, source: "auto", updatedAt: when }).run();
      added += 1;
    }
    return { added, removed };
  });
}

/**
 * Ручная строка админа поверх того, что сказал календарь.
 *
 * Отметка поверх авто-строки уносит её kind/note в `auto_*`, поверх ручной —
 * `auto_*` не трогает. `kind = null` снимает отметку: день сразу возвращается
 * к авто-значению, а не ждёт обновления календаря (до месяца — F2 аудита
 * 2026-10-15, когда праздник всё это время считался буднем). Снятие на
 * авто-строке ничего не делает: снимать там нечего.
 *
 * Ручные строки до миграции 0044 не знают, что было под ними (`auto_kind`
 * пуст). Для них запасной источник — зашитый календарь года, если он есть:
 * иначе снятие отметки с настоящего праздника опять дало бы будень на месяц.
 * Ошибётся он только если источник поправил дату задним числом, — и это
 * исправит ближайшее обновление, как исправило бы и раньше. Обычный день в
 * зашитом календаре отсутствует, и строка просто удаляется.
 */
export function setManualDay(db: Db, date: string, kind: DayKind | null, note: string | null, when: Date): void {
  db.transaction((tx) => {
    const current = tx.select().from(calendarDays).where(eq(calendarDays.date, date)).get();
    if (kind === null) {
      if (!current || current.source === "auto") return;
      const auto = current.autoKind ? { kind: current.autoKind, note: current.autoNote } : bundledDay(date);
      if (!auto) {
        tx.delete(calendarDays).where(eq(calendarDays.date, date)).run();
        return;
      }
      tx.update(calendarDays)
        .set({ kind: auto.kind, note: auto.note, source: "auto", autoKind: null, autoNote: null, updatedAt: when })
        .where(eq(calendarDays.date, date))
        .run();
      return;
    }
    const under =
      current?.source === "auto"
        ? { autoKind: current.kind, autoNote: current.note }
        : { autoKind: current?.autoKind ?? null, autoNote: current?.autoNote ?? null };
    tx.insert(calendarDays)
      .values({ date, kind, note, source: "manual", updatedAt: when, ...under })
      .onConflictDoUpdate({ target: calendarDays.date, set: { kind, note, source: "manual", updatedAt: when, ...under } })
      .run();
  });
}

/** Дата в зашитом календаре; `short` в таблицу не едет (`holiday-tick.ts`), поэтому не в счёт. */
function bundledDay(date: string): { kind: DayKind; note: string | null } | null {
  const day = BUNDLED_YEARS[Number(date.slice(0, 4))]?.days.find((d) => d.date === date);
  return day && day.kind !== "short" ? { kind: day.kind, note: day.note } : null;
}
