import type { ShiftTemplate } from "./types";

const MINUTES_PER_DAY = 24 * 60;

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Whole days since the Unix epoch for a YYYY-MM-DD wall-clock date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Absolute minutes since the Unix epoch for a wall-clock (date, time). */
export function absMinutes(date: string, time: string): number {
  return dayNumber(date) * MINUTES_PER_DAY + toMinutes(time);
}

/** 0 = Sunday … 6 = Saturday. Computed via UTC to avoid local-tz drift. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function resolveShiftTimes(tpl: ShiftTemplate, date: string): { start: string; end: string } {
  const isFriday = dayOfWeek(date) === 5;
  if (isFriday && tpl.fridayStart && tpl.fridayEnd) {
    return { start: tpl.fridayStart, end: tpl.fridayEnd };
  }
  return { start: tpl.start, end: tpl.end };
}

export function shiftDurationHours(shift: { start: string; end: string }): number {
  let mins = toMinutes(shift.end) - toMinutes(shift.start);
  if (mins < 0) mins += MINUTES_PER_DAY; // overnight shift ends next day
  return mins / 60;
}

/** Night = ends at/after 22:00, or crosses midnight. Reliable for our shift types. */
export function isNightShift(shift: { start: string; end: string }): boolean {
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  return end < start || end >= 22 * 60;
}

export function isWeekend(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/** A shift is "late" (evening/night, less desirable) if it runs overnight, ends at/after 20:00, or its template is flagged late. Used for fair-distribution balancing. */
export function isLateShift(shift: { start: string; end: string }, templateIsLate = false): boolean {
  if (templateIsLate) return true;
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (end < start) return true; // overnight
  return end >= 20 * 60;
}
