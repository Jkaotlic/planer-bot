import { shiftDurationHours, isNightShift, isWeekend } from "./time";

export interface ShiftForBalance {
  employeeId: number;
  date: string;
  start: string;
  end: string;
  isLate: boolean;
}

export interface EmployeeBalance {
  employeeId: number;
  hours: number;
  nights: number;
  weekends: number;
  lateShifts: number;
}

export function computeBalance(shifts: ShiftForBalance[], employeeIds: number[]): EmployeeBalance[] {
  const byId = new Map<number, EmployeeBalance>();
  for (const id of employeeIds) {
    byId.set(id, { employeeId: id, hours: 0, nights: 0, weekends: 0, lateShifts: 0 });
  }
  for (const s of shifts) {
    const row = byId.get(s.employeeId);
    if (!row) continue;
    row.hours += shiftDurationHours(s);
    if (isNightShift(s)) row.nights += 1;
    if (isWeekend(s.date)) row.weekends += 1;
    if (s.isLate) row.lateShifts += 1;
  }
  return employeeIds.map((id) => byId.get(id)!);
}
