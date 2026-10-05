import { MONTH_NAMES } from "./birthday";
import { addDaysIso, eachDayIso } from "./week-dates";

/**
 * Больничный, ждущий ОК, — строкой списка «На подтверждение» (обе морды).
 *
 * Тип здесь, а не в каждом клиенте: сервер отдаёт его через `satisfies`, и форма
 * не может разъехаться между ручкой и двумя экранами.
 */
export interface SickApprovalRow {
  /** id записи графика — по нему жмут ОК и «Отклонить». */
  id: number;
  employeeId: number;
  employeeName: string;
  date: string;
  endDate: string | null;
  /** ISO-момент, с которого ждёт. */
  requestedAt: string;
  /** Смены, которые больничный забирает: «Вт 6 окт · 08:00–17:00 · Утро». */
  shiftLines: string[];
  /**
   * Заполнено, только если ждёт ОК именно ПРОДЛЕНИЕ: уже подтверждённый срок. Дни
   * внутри него подтверждены; спрашивают только про остальные (`sickExtensionRuns`).
   */
  approvedSpan?: SickSpan;
  /** Передачу уже запустили без ОК — смена была слишком близко (п. 11 спеки). */
  handoverForced: boolean;
}

/** Срок больничного: как `date`/`endDate` записи. */
export interface SickSpan {
  date: string;
  endDate: string | null;
}

/**
 * Дни `entry`, которых нет в уже подтверждённом `approved`, — подряд идущими кусками.
 * Два куска бывают, когда больничный потянули в обе стороны сразу; склеить их
 * через подтверждённые дни значило бы спросить ОК и про них.
 */
export function sickExtensionRuns(approved: SickSpan, entry: SickSpan): SickSpan[] {
  const had = new Set(eachDayIso(approved.date, approved.endDate ?? approved.date));
  const fresh = eachDayIso(entry.date, entry.endDate ?? entry.date).filter((day) => !had.has(day));
  const runs: SickSpan[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const close = () => {
    if (start != null && prev != null) runs.push({ date: start, endDate: prev === start ? null : prev });
  };
  for (const day of fresh) {
    if (prev != null && addDaysIso(prev, 1) === day) {
      prev = day;
      continue;
    }
    close();
    start = day;
    prev = day;
  }
  close();
  return runs;
}

function dayMonth(iso: string): { day: number; month: number } {
  return { day: Number(iso.slice(8, 10)), month: Number(iso.slice(5, 7)) };
}

/** «с 6 по 8 октября» — письмо работнику. Год не пишется: больничный не бывает через год. */
export function sickSpanWords(date: string, endDate: string | null): string {
  const from = dayMonth(date);
  if (!endDate || endDate === date) return `на ${from.day} ${MONTH_NAMES[from.month - 1]}`;
  const to = dayMonth(endDate);
  if (from.month === to.month) return `с ${from.day} по ${to.day} ${MONTH_NAMES[to.month - 1]}`;
  return `с ${from.day} ${MONTH_NAMES[from.month - 1]} по ${to.day} ${MONTH_NAMES[to.month - 1]}`;
}

// Родительный падеж короткого месяца даёт сам Intl («окт.», «сент.»): своя
// таблица сокращений разошлась бы с `dayLabel` в соседних строках письма.
const SHORT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

function shortParts(iso: string): { day: string; month: string } {
  const parts = SHORT.formatToParts(new Date(`${iso}T00:00:00Z`));
  return {
    day: parts.find((p) => p.type === "day")?.value ?? "",
    month: parts.find((p) => p.type === "month")?.value ?? "",
  };
}

/** «6–8 окт.» — заголовок письма админам. */
export function sickSpanShort(date: string, endDate: string | null): string {
  const from = shortParts(date);
  if (!endDate || endDate === date) return `${from.day} ${from.month}`;
  const to = shortParts(endDate);
  if (from.month === to.month) return `${from.day}–${to.day} ${to.month}`;
  return `${from.day} ${from.month} – ${to.day} ${to.month}`;
}
