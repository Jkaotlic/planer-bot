/**
 * Date/week helpers for the schedule screens. Everything works off local
 * (browser) time and plain "YYYY-MM-DD" strings — there's no server clock
 * available client-side, and Telegram Mini Apps run in the user's own
 * timezone context anyway.
 */

import {
  addDays,
  formatWeekRangeLabel,
  mondayOf,
  parseISODate,
  toISODate,
  weekdayIndex,
  weekdayShort,
  WEEKDAY_SHORT_RU,
} from "@planer/shared";

// Переехало в @planer/shared: тем же календарём сервер рисует картинку недели
// для бота, и расходиться две копии не должны.
export {
  addDays,
  formatWeekRangeLabel,
  mondayOf,
  parseISODate,
  toISODate,
  weekdayIndex,
  weekdayShort,
  WEEKDAY_SHORT_RU,
};

const MONTH_SHORT_RU: readonly string[] = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const monthDayFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

export function dayOfMonth(iso: string): string {
  return String(parseISODate(iso).getDate());
}

/** Compact "1 июл" form used by the day badge (deliberately period-free, unlike Intl's "июл."). */
export function formatShortDate(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTH_SHORT_RU[d.getMonth()]}`;
}

export function isWeekendIso(iso: string): boolean {
  const idx = weekdayIndex(iso);
  return idx === 5 || idx === 6;
}

/**
 * The shown week's days, plus a date the entry already holds that falls outside
 * them.
 *
 * The entry form is opened from a week grid, so its day pickers offer that week.
 * But an absence imported from the roster routinely runs longer than one week, and
 * a `<select>` whose value matches none of its options renders as the *first* one:
 * the screen then tells the admin the отпуск ends on Monday when it really runs to
 * the 22nd, and one touch of the control shortens it to Sunday for real — there is
 * no way to express the stored date from that screen at all. Carrying the entry's
 * own date into the list keeps the form able to show, and re-save, what is there.
 */
export function dayOptions(weekDates: readonly string[], current: string): string[] {
  return weekDates.includes(current) ? [...weekDates] : [...weekDates, current].sort();
}

/** "Пн, 14 июля" */
export function formatDayLabel(iso: string): string {
  return `${weekdayShort(iso)}, ${monthDayFormatter.format(parseISODate(iso))}`;
}

/**
 * "Сегодня, Ср 29 июля" on the current day, "Чт, 30 июля" on any other.
 *
 * `today` is passed in rather than read from the clock so the function stays
 * pure and testable — the screens hand it `toISODate(new Date())`.
 */
export function formatDayLabelRelative(iso: string, today: string): string {
  if (iso !== today) return formatDayLabel(iso);
  return `Сегодня, ${weekdayShort(iso)} ${monthDayFormatter.format(parseISODate(iso))}`;
}

/** "16–17 июл", or "28 июл – 3 авг" across a month boundary — for the day badge. */
export function formatShortDateRange(startIso: string, endIso: string): string {
  const start = parseISODate(startIso);
  const end = parseISODate(endIso);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_SHORT_RU[start.getMonth()]}`;
  }
  return `${formatShortDate(startIso)} – ${formatShortDate(endIso)}`;
}

/**
 * Does the shown period already contain today? The "back to today" affordance
 * hides when it does, so it never occupies space it cannot use.
 *
 * Both arguments are "YYYY-MM-DD"; `today` is passed in rather than read from
 * the clock, so this stays pure.
 */
export function isCurrentPeriod(mode: "day" | "week", shownIso: string, todayIso: string): boolean {
  if (mode === "day") return shownIso === todayIso;
  return toISODate(mondayOf(parseISODate(shownIso))) === toISODate(mondayOf(parseISODate(todayIso)));
}
