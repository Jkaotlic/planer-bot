import { eq } from "drizzle-orm";
import {
  distributeFairly,
  lateWeight,
  shiftDurationHours,
  countsForBalance,
  isAbsence,
  type FillSlot,
  type WorkerLoad,
} from "@planer/shared";
import type { Db } from "../db/client";
import { shifts } from "../db/schema";
import { listUnassignedShifts, listShiftsByEmployee } from "../repo/shifts";
import { listActive, getEmployeeById } from "../repo/employees";

export interface DistributionAssignment {
  shiftId: number;
  employeeId: number;
  employeeName: string;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Expands an inclusive YYYY-MM-DD range to every date it covers, clamped to [from, to]. Deterministic (no wall-clock reads). */
function expandDateRange(start: string, end: string, from: string, to: string): string[] {
  const clampedStart = start < from ? from : start;
  const clampedEnd = end > to ? to : end;
  if (clampedStart > clampedEnd) return [];
  const [sy, sm, sd] = clampedStart.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = clampedEnd.split("-").map(Number) as [number, number, number];
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

function seedWorkerLoad(db: Db, employeeId: number, from: string, to: string): WorkerLoad {
  const employeeShifts = listShiftsByEmployee(db, employeeId);
  const timed = employeeShifts.filter((s) => s.start != null && s.end != null && inRange(s.date, from, to));
  let lateScore = 0;
  let hours = 0;
  for (const s of timed) {
    if (!countsForBalance(s.category)) continue;
    const shift = { start: s.start as string, end: s.end as string };
    lateScore += lateWeight(shift);
    hours += shiftDurationHours(shift);
  }
  const busy = timed.map((s) => ({ date: s.date, start: s.start as string, end: s.end as string }));

  const absences = employeeShifts.filter((s) => isAbsence(s.category) && overlapsRange(s, from, to));
  const absentDatesSet = new Set<string>();
  for (const s of absences) {
    const end = s.endDate ?? s.date;
    for (const d of expandDateRange(s.date, end, from, to)) absentDatesSet.add(d);
  }
  const absentDates = [...absentDatesSet];

  return { employeeId, lateScore, hours, busy, absentDates };
}

/** An absence entry overlaps [from, to] if its range [date, endDate ?? date] intersects it. */
function overlapsRange(s: { date: string; endDate: string | null }, from: string, to: string): boolean {
  const end = s.endDate ?? s.date;
  return s.date <= to && end >= from;
}

/** Proposes assignments for unfilled 'shift' slots in [from, to], balancing late load across active workers. */
export function buildDistribution(db: Db, from: string, to: string): { assignments: DistributionAssignment[] } {
  const unassigned = listUnassignedShifts(db, from, to);
  const slots: FillSlot[] = unassigned.map((s) => ({
    id: s.id,
    date: s.date,
    start: s.start as string,
    end: s.end as string,
  }));

  const workers = listActive(db).map((e) => seedWorkerLoad(db, e.id, from, to));

  const assignments = distributeFairly(slots, workers).map((a) => ({
    shiftId: a.shiftId,
    employeeId: a.employeeId,
    employeeName: getEmployeeById(db, a.employeeId)?.displayName ?? "",
  }));

  return { assignments };
}

/** Applies a proposed distribution, writing employeeId on each shift in one transaction. */
export function applyDistribution(db: Db, assignments: { shiftId: number; employeeId: number }[]): void {
  db.transaction((tx) => {
    for (const a of assignments) {
      tx.update(shifts).set({ employeeId: a.employeeId }).where(eq(shifts.id, a.shiftId)).run();
    }
  });
}
