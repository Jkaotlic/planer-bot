import { eq } from "drizzle-orm";
import { distributeFairly, lateWeight, shiftDurationHours, countsForBalance, type FillSlot, type WorkerLoad } from "@planer/shared";
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

function seedWorkerLoad(db: Db, employeeId: number, from: string, to: string): WorkerLoad {
  const timed = listShiftsByEmployee(db, employeeId).filter(
    (s) => s.start != null && s.end != null && inRange(s.date, from, to),
  );
  let lateScore = 0;
  let hours = 0;
  for (const s of timed) {
    if (!countsForBalance(s.category)) continue;
    const shift = { start: s.start as string, end: s.end as string };
    lateScore += lateWeight(shift);
    hours += shiftDurationHours(shift);
  }
  const busy = timed.map((s) => ({ date: s.date, start: s.start as string, end: s.end as string }));
  return { employeeId, lateScore, hours, busy };
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
