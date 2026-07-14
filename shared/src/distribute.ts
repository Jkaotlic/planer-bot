import { toMinutes, shiftDurationHours, isNightShift } from "./time";
import { shiftsOverlap } from "./overlap";

export interface FillSlot {
  id: number;
  date: string;
  start: string;
  end: string;
}

export interface WorkerLoad {
  employeeId: number;
  lateScore: number; // seeded from existing period load
  hours: number; // seeded from existing period load
  busy: { date: string; start: string; end: string }[]; // their timed shifts (overlap check), seeded + grown
}

export interface Assignment {
  shiftId: number;
  employeeId: number;
}

/** night=2, evening (ends 20:00-21:59, not overnight/night)=1, else 0 */
export function lateWeight(shift: { start: string; end: string }): number {
  if (isNightShift(shift)) return 2;
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (end > start && end >= 20 * 60 && end < 22 * 60) return 1;
  return 0;
}

/**
 * Assign heaviest slots first to the least-loaded eligible (non-overlapping) worker;
 * tiebreak by hours then id. Pure (works on copies). Leaves a slot unassigned if nobody is free.
 */
export function distributeFairly(slots: FillSlot[], workers: WorkerLoad[]): Assignment[] {
  const load = workers.map((w) => ({ ...w, busy: [...w.busy] }));
  const order = [...slots].sort((a, b) => lateWeight(b) - lateWeight(a));
  const out: Assignment[] = [];
  for (const slot of order) {
    const free = load.filter((w) => !w.busy.some((b) => shiftsOverlap(b, slot)));
    if (free.length === 0) continue;
    free.sort((a, b) => a.lateScore - b.lateScore || a.hours - b.hours || a.employeeId - b.employeeId);
    const w = free[0]!;
    out.push({ shiftId: slot.id, employeeId: w.employeeId });
    w.lateScore += lateWeight(slot);
    w.hours += shiftDurationHours(slot);
    w.busy.push({ date: slot.date, start: slot.start, end: slot.end });
  }
  return out;
}
