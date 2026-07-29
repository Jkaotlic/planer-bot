/**
 * Date/week helpers for the schedule screens. Everything works off local
 * (browser) time and plain "YYYY-MM-DD" strings — there's no server clock
 * available client-side, and Telegram Mini Apps run in the user's own
 * timezone context anyway.
 */

/** Monday-first weekday abbreviations, index 0 = Monday. */
export const WEEKDAY_SHORT_RU: readonly string[] = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats a local `Date` as "YYYY-MM-DD" (no timezone conversion). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parses a "YYYY-MM-DD" string as a local-midnight `Date`. */
export function parseISODate(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Midnight Monday of the week containing `d` (ISO week start). */
export function mondayOf(d: Date): Date {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const sinceMonday = (dow + 6) % 7;
  const monday = addDays(d, -sinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** 0 = Monday .. 6 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT_RU[weekdayIndex(iso)] ?? "";
}

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

/** "13–19 июля" (or "28 июля – 3 августа" across a month boundary). */
export function formatWeekRangeLabel(monday: Date, sunday: Date): string {
  return monthDayFormatter.formatRange(monday, sunday);
}

/** First token of a full display name, e.g. "Аня Смирнова" -> "Аня". */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
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
