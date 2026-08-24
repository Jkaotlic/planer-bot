import type { Shift } from "../api/client";

/** "08:00–17:00", or "Весь день" for absences with no concrete times. */
export function formatTimeRange(shift: Pick<Shift, "start" | "end">): string {
  if (shift.start && shift.end) return `${shift.start}–${shift.end}`;
  return "Весь день";
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Duration in hours; 0 for entries without concrete times (absences). */
export function durationHours(shift: Pick<Shift, "start" | "end">): number {
  if (!shift.start || !shift.end) return 0;
  const startMin = toMinutes(shift.start);
  let endMin = toMinutes(shift.end);
  if (endMin <= startMin) endMin += 24 * 60; // overnight shift
  return (endMin - startMin) / 60;
}

export function totalHours(shifts: readonly Pick<Shift, "start" | "end">[]): number {
  return shifts.reduce((sum, s) => sum + durationHours(s), 0);
}

/**
 * Russian plural form for a count: 1 -> one, 2-4 -> few, 5+ -> many
 * (with the standard 11-14 exception, which always takes `many`).
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Дописывается к уже существующему сообщению об успехе — сохранение записи,
 * импорт, распределение, заполнение недели, — а не заводит своё место на экране.
 * Правило то же, что у `reachNotice` (AdminWeekendScreen.tsx): молчим, когда
 * дошло до всех или уведомлять было некого, говорим вслух, когда часть команды
 * не подключила телеграм. Живёт здесь, а не в конкретном экране, потому что
 * нужна и «Расписанию», и «Графику файлом» — раздельный импорт друг у друга
 * дал бы цикл между их модулями.
 */
export function notifyNotice(reach: { delivered: number; intended: number }): string | null {
  if (reach.intended === 0 || reach.delivered >= reach.intended) return null;
  return `Уведомление дошло до ${reach.delivered} из ${reach.intended}: остальные не подключили телеграм.`;
}

/**
 * То же самое, но про письмо, которое ещё НЕ ушло.
 *
 * Одиночная правка копится в буфере сервера до двадцати секунд, поэтому в
 * момент ответа факта доставки нет — есть только знание, у кого из адресатов
 * привязан телеграм. Врать словом «дошло» об этом нельзя, а молчать не надо:
 * фраза произносится ровно в том же случае, что и раньше, — часть команды не
 * подключила телеграм, и об этом админ должен узнать сразу.
 *
 * `notifyNotice` рядом остаётся: импорт файла и «Заполнить неделю» отправляют
 * внутри запроса и отчитываются о факте.
 */
export function notifyPendingNotice(reach: { delivered: number; intended: number }): string | null {
  if (reach.intended === 0 || reach.delivered >= reach.intended) return null;
  return `Уведомление уйдёт ${reach.delivered} из ${reach.intended}: остальные не подключили телеграм.`;
}

/** Приписывает `notifyNotice` к базовому сообщению, если есть что сказать. */
export function withNotifyNotice(base: string, reach: { delivered: number; intended: number }): string {
  const extra = notifyNotice(reach);
  return extra ? `${base} ${extra}` : base;
}
