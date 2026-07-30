import { toMinutes, isNightShift, nextDate } from "./time";
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
  /**
   * Who is allowed to take this kind at all — a hard filter, not a preference.
   * Empty or absent means everyone, which is what an unconfigured preset looks
   * like: nobody has to be "excluded", the people who don't do it simply aren't
   * listed.
   */
  pool?: readonly number[] | null;
  /**
   * Who asked for this kind, and how strongly (higher wins). A soft tiebreak
   * only: someone who likes evenings gets one when they are otherwise level on
   * evenings, never when they already hold more of them than the next person.
   */
  preference?: Readonly<Record<number, number>> | null;
}

export interface WorkerLoad {
  employeeId: number;
  /** How many shifts of each kind they already hold this period, seeded from the schedule. */
  byKind: Record<string, number>;
  /** Total shifts held — a tiebreak so the overall count stays even too. */
  total: number;
  busy: { date: string; start: string; end: string }[]; // their timed shifts (overlap check), seeded + grown
  /**
   * Dates (YYYY-MM-DD) they must not be given anything on: away (vacation / sick
   * leave / business trip), or — from a caller with no interval to check, such as a
   * roster cell nobody could read — some other reason the whole day is spoken for.
   * A hard block, not a preference.
   */
  absentDates: string[];
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

/** An empty pool is an unconfigured one: everybody may take the slot. */
function allowedBy(slot: FillSlot, employeeId: number): boolean {
  return !slot.pool || slot.pool.length === 0 || slot.pool.includes(employeeId);
}

function preferenceOf(slot: FillSlot, employeeId: number): number {
  return slot.preference?.[employeeId] ?? 0;
}

/**
 * Every date a slot actually occupies — two of them when it runs past midnight.
 *
 * An absence is a whole day off, so a 22:00→06:00 slot has to clear the *next*
 * day too: otherwise the first morning of somebody's vacation or sick leave is
 * spent at work. The seeding side already reaches across midnight for `busy`
 * (see seedWorkerLoad in the server's distribute-service); this is the same reach
 * on the absence side, which was the asymmetry.
 */
function datesOf(slot: FillSlot): string[] {
  const overnight = toMinutes(slot.end) < toMinutes(slot.start);
  return overnight ? [slot.date, nextDate(slot.date)] : [slot.date];
}

/**
 * Fills each open slot with the eligible (allowed, free, not absent,
 * non-overlapping) worker who holds the fewest shifts **of that same kind** — so
 * mornings, days, evenings and nights each even out on their own, instead of one
 * person collecting all the nights while the totals look balanced.
 *
 * Order of the comparator, and why:
 *   1. fewest of this kind   — the fairness rule itself
 *   2. who asked for it      — a preference has to sit *here*: above it would
 *                              override fairness, below `total` it would never
 *                              fire, because after the counts diverge `total`
 *                              ties stop happening
 *   3. fewest shifts overall — keeps the totals from drifting apart too
 *   4. id                    — so the result is deterministic
 *
 * Pure: works on copies. A slot nobody is eligible for is left unassigned.
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
    const occupies = datesOf(slot);
    const free = load.filter(
      (w) =>
        allowedBy(slot, w.employeeId) &&
        !occupies.some((date) => w.absentDates.includes(date)) &&
        !w.busy.some((b) => shiftsOverlap(b, slot)),
    );
    if (free.length === 0) continue;
    free.sort(
      (a, b) =>
        countOf(a, slot.kind) - countOf(b, slot.kind) ||
        preferenceOf(slot, b.employeeId) - preferenceOf(slot, a.employeeId) ||
        a.total - b.total ||
        a.employeeId - b.employeeId,
    );
    const w = free[0]!;
    out.push({ shiftId: slot.id, employeeId: w.employeeId });
    w.byKind[slot.kind] = countOf(w, slot.kind) + 1;
    w.total += 1;
    w.busy.push({ date: slot.date, start: slot.start, end: slot.end });
  }
  return out;
}
