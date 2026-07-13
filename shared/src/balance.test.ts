import { describe, it, expect } from "vitest";
import { computeBalance, type ShiftForBalance } from "./balance";

const shifts: ShiftForBalance[] = [
  { employeeId: 1, date: "2026-07-01", start: "08:00", end: "17:00", isLate: false }, // Wed, 9h
  { employeeId: 1, date: "2026-07-04", start: "15:00", end: "23:00", isLate: true },  // Sat night, 8h
  { employeeId: 2, date: "2026-07-01", start: "11:00", end: "20:00", isLate: true },  // Wed evening, 9h
];

describe("computeBalance", () => {
  it("aggregates hours, nights, weekends, late shifts per employee", () => {
    const result = computeBalance(shifts, [1, 2]);
    expect(result).toEqual([
      { employeeId: 1, hours: 17, nights: 1, weekends: 1, lateShifts: 1 },
      { employeeId: 2, hours: 9, nights: 0, weekends: 0, lateShifts: 1 },
    ]);
  });

  it("includes employees with no shifts as zero rows", () => {
    const result = computeBalance([], [5]);
    expect(result).toEqual([{ employeeId: 5, hours: 0, nights: 0, weekends: 0, lateShifts: 0 }]);
  });

  it("ignores shifts for employees not in the id list", () => {
    const result = computeBalance([{ employeeId: 99, date: "2026-07-01", start: "08:00", end: "17:00", isLate: false }], [1]);
    expect(result).toEqual([{ employeeId: 1, hours: 0, nights: 0, weekends: 0, lateShifts: 0 }]);
  });
});
