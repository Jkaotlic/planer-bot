import { toMinutes, dayNumber, shiftDurationHours } from "./time";

type TimedShift = { date: string; start: string; end: string };

/** Absolute [start, end) in minutes since epoch, so overnight & cross-day math just works. */
export function shiftInterval(shift: TimedShift): { start: number; end: number } {
  const start = dayNumber(shift.date) * 24 * 60 + toMinutes(shift.start);
  const end = start + Math.round(shiftDurationHours(shift) * 60);
  return { start, end };
}

export function shiftsOverlap(a: TimedShift, b: TimedShift): boolean {
  const ia = shiftInterval(a);
  const ib = shiftInterval(b);
  return ia.start < ib.end && ib.start < ia.end;
}
