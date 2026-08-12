/**
 * Календарь недели: общий и для мини-аппа, и для картинки, которую рисует бот.
 *
 * Пары функций: над `Date` — для экранов, где дата уже разобрана, и над строками
 * `YYYY-MM-DD` (суффикс `Iso`) — для сервера, где объект `Date` затащил бы в
 * арифметику часовой пояс машины вместо часового пояса команды.
 */

/** Monday-first weekday abbreviations, index 0 = Monday. */
export const WEEKDAY_SHORT_RU: readonly string[] = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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

/** Same, on the "YYYY-MM-DD" level — no `Date` ever escapes into caller code. */
export function addDaysIso(iso: string, days: number): string {
  return toISODate(addDays(parseISODate(iso), days));
}

/** Midnight Monday of the week containing `d` (ISO week start). */
export function mondayOf(d: Date): Date {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const sinceMonday = (dow + 6) % 7;
  const monday = addDays(d, -sinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function mondayOfIso(iso: string): string {
  return toISODate(mondayOf(parseISODate(iso)));
}

/** 0 = Monday .. 6 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT_RU[weekdayIndex(iso)] ?? "";
}

/** "13–19 июля" (or "28 июля – 3 августа" across a month boundary). */
export function formatWeekRangeLabel(monday: Date, sunday: Date): string {
  return monthDayFormatter.formatRange(monday, sunday);
}

export function formatWeekRangeLabelIso(mondayIso: string, sundayIso: string): string {
  return formatWeekRangeLabel(parseISODate(mondayIso), parseISODate(sundayIso));
}

/**
 * Каждый день диапазона включительно: `["2026-08-12", "2026-08-13", "2026-08-14"]`.
 *
 * Понадобилось письму админам о многодневном больничном: оно обязано пройти по
 * каждому дню и сказать, что на нём стоит. Считать через `addDaysIso`, а не
 * прибавлять к числу: у августа 31 день, а у сентября 30, и «date + 1» через
 * границу месяца врёт.
 *
 * Перевёрнутый диапазон отдаёт пустой список, а не крутится вечно: такой вход
 * приходит из тела запроса, и цикл `while (day <= to)` на нём просто не
 * начнётся — но полагаться на это молча нельзя, поэтому здесь есть тест.
 */
export function eachDayIso(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDaysIso(day, 1)) days.push(day);
  return days;
}
