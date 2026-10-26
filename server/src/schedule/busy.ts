import { dayNumber, nextDate, prevDate, shiftInterval, shiftsOverlap } from "@planer/shared";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { listEmployeeShiftsOverlapping } from "../repo/shifts";

/** Интервал, про который спрашивают «свободен ли человек». Форма — как у записи
 *  графика, чтобы саму запись можно было передать без перекладывания полей. */
export type BusyProbe = { date: string; endDate?: string | null; start: string | null; end: string | null };

const MINUTES_PER_DAY = 24 * 60;

/**
 * Абсолютный [начало, конец) записи в минутах. Запись без часов — отпуск,
 * больничный, импортированный «?» — занимает свои дни целиком: так её рисует
 * сетка, и так её понимал прежний `standsInTheWay` у передач.
 */
function spanOf(e: BusyProbe): { start: number; end: number } {
  if (e.start != null && e.end != null) return shiftInterval({ date: e.date, start: e.start, end: e.end });
  return {
    start: dayNumber(e.date) * MINUTES_PER_DAY,
    end: (dayNumber(e.endDate ?? e.date) + 1) * MINUTES_PER_DAY,
  };
}

function clashes(mine: Shift, at: BusyProbe): boolean {
  // Обе стороны с часами — ровно тот `shiftsOverlap`, которым меряет обмен:
  // три поверхности (обмен, передача, выходные) не должны расходиться в том,
  // что значит «занят».
  if (mine.start != null && mine.end != null && at.start != null && at.end != null) {
    return shiftsOverlap({ date: mine.date, start: mine.start, end: mine.end }, { date: at.date, start: at.start, end: at.end });
  }
  // Хоть одна сторона — целые дни. Полуинтервал тот же, что у `shiftsOverlap`:
  // смена до 00:00 накануне отпуска его не задевает.
  const a = spanOf(mine);
  const b = spanOf(at);
  return a.start < b.end && b.start < a.end;
}

/**
 * Первая запись человека, которая стоит поперёк `at`, или `null`, если он свободен.
 *
 * Окно чтения — на сутки шире интервала с обеих сторон, а не дни самой смены:
 * ночь 22:00–08:00 записана на вчерашнюю дату и при выборке «только этот день»
 * не попадала в поле зрения. Так передача предлагала утреннюю смену человеку,
 * который в это утро ещё не ушёл с ночной (H7, аудит 2026-10-26). Больше суток
 * в обе стороны не нужно: запись с часами короче суток.
 *
 * `ignoreEntryId` — сама запись, о которой идёт речь: человек не занят своей же
 * сменой, которую отдаёт или меняет.
 */
export function busyWith(db: Db, employeeId: number, at: BusyProbe, opts: { ignoreEntryId?: number } = {}): Shift | null {
  const around = listEmployeeShiftsOverlapping(db, employeeId, prevDate(at.date), nextDate(at.endDate ?? at.date));
  return around.find((mine) => mine.id !== opts.ignoreEntryId && clashes(mine, at)) ?? null;
}
