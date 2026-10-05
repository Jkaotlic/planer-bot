import { MONTH_NAMES } from "./birthday";

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
  /** Передачу уже запустили без ОК — смена была слишком близко (п. 11 спеки). */
  handoverForced: boolean;
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
