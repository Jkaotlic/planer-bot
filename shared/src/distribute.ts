import { toMinutes, isNightShift } from "./time";
import { shiftsOverlap } from "./overlap";

export interface FillSlot {
  id: number;
  date: string;
  start: string;
  end: string;
  /**
   * Which kind of shift this is — normally the preset's name ("Утро"/"День"/
   * "Вечер"/"Ночь"). Fairness is judged per kind: the question is never "who has
   * worked fewer hours" but "who has had the fewest Ночь shifts".
   */
  kind: string;
}

export interface WorkerLoad {
  employeeId: number;
  /** How many shifts of each kind they already hold this period, seeded from the schedule. */
  byKind: Record<string, number>;
  /** Total shifts held — a tiebreak so the overall count stays even too. */
  total: number;
  busy: { date: string; start: string; end: string }[]; // their timed shifts (overlap check), seeded + grown
  absentDates: string[]; // dates (YYYY-MM-DD) they're away: vacation / sick leave / business trip
}

export interface Assignment {
  shiftId: number;
  employeeId: number;
}

/**
 * night=2, evening (ends 20:00-21:59, not overnight/night)=1, else 0.
 * Used only to decide which slots are handed out *first*, so the least-wanted
 * ones get spread before the roster fills up — never to rank workers.
 */
export function lateWeight(shift: { start: string; end: string }): number {
  if (isNightShift(shift)) return 2;
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (end > start && end >= 20 * 60 && end < 22 * 60) return 1;
  return 0;
}

function countOf(load: WorkerLoad, kind: string): number {
  return load.byKind[kind] ?? 0;
}

/**
 * Fills each open slot with the eligible (free, not absent, non-overlapping) worker
 * who holds the fewest shifts **of that same kind** — so mornings, days, evenings
 * and nights each even out on their own, instead of one person collecting all the
 * nights while the totals look balanced. Ties break on total shifts, then id.
 *
 * Pure: works on copies. A slot nobody is free for is left unassigned.
 */
export function distributeFairly(slots: FillSlot[], workers: WorkerLoad[]): Assignment[] {
  const load = workers.map((w) => ({
    ...w,
    byKind: { ...w.byKind },
    busy: [...w.busy],
    absentDates: [...w.absentDates],
  }));
  const order = [...slots].sort(
    (a, b) =>
      lateWeight(b) - lateWeight(a) ||
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.id - b.id,
  );

  const out: Assignment[] = [];
  for (const slot of order) {
    const free = load.filter((w) => !w.absentDates.includes(slot.date) && !w.busy.some((b) => shiftsOverlap(b, slot)));
    if (free.length === 0) continue;
    free.sort((a, b) => countOf(a, slot.kind) - countOf(b, slot.kind) || a.total - b.total || a.employeeId - b.employeeId);
    const w = free[0]!;
    out.push({ shiftId: slot.id, employeeId: w.employeeId });
    w.byKind[slot.kind] = countOf(w, slot.kind) + 1;
    w.total += 1;
    w.busy.push({ date: slot.date, start: slot.start, end: slot.end });
  }
  return out;
}
