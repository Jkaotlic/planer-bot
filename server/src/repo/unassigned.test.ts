import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift, listUnassignedShifts } from "./shifts";

describe("listUnassignedShifts", () => {
  it("returns only unassigned 'shift' entries with times, within the date range", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });

    const wanted = createShift(db, { date: "2026-07-05", start: "08:00", end: "17:00" }); // unassigned shift in range
    createShift(db, { date: "2026-07-05", start: "09:00", end: "18:00", employeeId: anya.id }); // assigned -> excluded
    createShift(db, { date: "2026-07-05", category: "vacation" }); // wrong category -> excluded
    createShift(db, { date: "2026-01-01", start: "08:00", end: "17:00" }); // out of range -> excluded
    createShift(db, { date: "2026-07-06", category: "shift" }); // no start/end -> excluded

    const result = listUnassignedShifts(db, "2026-07-01", "2026-07-10");
    expect(result.map((s) => s.id)).toEqual([wanted.id]);
  });

  it("returns an empty array when nothing matches", () => {
    const db = makeTestDb();
    expect(listUnassignedShifts(db, "2026-07-01", "2026-07-10")).toEqual([]);
  });
});
