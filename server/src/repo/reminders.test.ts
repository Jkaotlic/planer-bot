import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift } from "./shifts";
import { hasReminder, addReminder } from "./reminders";

describe("reminders repo", () => {
  it("hasReminder is false until addReminder is called for that shift+kind", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const shift = createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: anya.id });

    expect(hasReminder(db, shift.id, "evening_before")).toBe(false);
    addReminder(db, shift.id, "evening_before");
    expect(hasReminder(db, shift.id, "evening_before")).toBe(true);
  });

  it("is scoped per kind — a different kind on the same shift is still unsent", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const shift = createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: anya.id });

    addReminder(db, shift.id, "evening_before");
    expect(hasReminder(db, shift.id, "other_kind")).toBe(false);
  });
});
