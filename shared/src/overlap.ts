import { absMinutes, dayNumber, shiftDurationHours } from "./time";

type TimedShift = { date: string; start: string; end: string };

/** Absolute [start, end) in minutes since epoch, so overnight & cross-day math just works. */
export function shiftInterval(shift: TimedShift): { start: number; end: number } {
  const start = absMinutes(shift.date, shift.start);
  const end = start + Math.round(shiftDurationHours(shift) * 60);
  return { start, end };
}

export function shiftsOverlap(a: TimedShift, b: TimedShift): boolean {
  const ia = shiftInterval(a);
  const ib = shiftInterval(b);
  return ia.start < ib.end && ib.start < ia.end;
}

/** Запись графика с часами или без — форма, общая для строки базы, DTO и слота. */
export type BusySpan = { date: string; endDate?: string | null; start: string | null; end: string | null };

const MINUTES_PER_DAY = 24 * 60;

/**
 * Абсолютный [начало, конец) записи в минутах. Запись без часов — отпуск,
 * больничный, импортированный «?» — занимает свои дни целиком: так её рисует
 * сетка.
 */
function busySpanOf(e: BusySpan): { start: number; end: number } {
  if (e.start != null && e.end != null) return shiftInterval({ date: e.date, start: e.start, end: e.end });
  return {
    start: dayNumber(e.date) * MINUTES_PER_DAY,
    end: (dayNumber(e.endDate ?? e.date) + 1) * MINUTES_PER_DAY,
  };
}

/**
 * Стоит ли запись `a` поперёк `b` — одно правило «занят» для сервера
 * (`busyWith`) и dev-моков консоли и мини-аппа, чтобы мок отказывал там же,
 * где сервер.
 */
export function entriesClash(a: BusySpan, b: BusySpan): boolean {
  // Обе стороны с часами — ровно тот `shiftsOverlap`, которым меряет обмен:
  // поверхности (обмен, передача, выходные) не должны расходиться в том, что
  // значит «занят».
  if (a.start != null && a.end != null && b.start != null && b.end != null) {
    return shiftsOverlap({ date: a.date, start: a.start, end: a.end }, { date: b.date, start: b.start, end: b.end });
  }
  // Хоть одна сторона — целые дни. Полуинтервал тот же, что у `shiftsOverlap`:
  // смена до 00:00 накануне отпуска его не задевает.
  const x = busySpanOf(a);
  const y = busySpanOf(b);
  return x.start < y.end && y.start < x.end;
}
