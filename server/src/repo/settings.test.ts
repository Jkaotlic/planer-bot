import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { appSettings } from "../db/schema";
import { isSwapsLocked, setSwapsLocked } from "./settings";

describe("app settings", () => {
  // A database that has never seen this feature must behave exactly as before:
  // the migration inserts nothing, and «no row» has to read as «swaps are open».
  it("reads an empty table as unlocked", () => {
    expect(isSwapsLocked(makeTestDb())).toBe(false);
  });

  it("round-trips the lock in both directions", () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Игорь Петров" });
    setSwapsLocked(db, true, admin.id);
    expect(isSwapsLocked(db)).toBe(true);
    setSwapsLocked(db, false, admin.id);
    expect(isSwapsLocked(db)).toBe(false);
  });

  // Idempotent: the toggle is a switch, not a log. Two presses of «закрыть» must
  // leave one row, or `isSwapsLocked` would depend on which row it happened to read.
  it("keeps exactly one row when set twice", () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Игорь Петров" });
    setSwapsLocked(db, true, admin.id);
    setSwapsLocked(db, true, admin.id);
    const rows = db.select().from(appSettings).where(eq(appSettings.key, "swaps_locked")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedByEmployeeId).toBe(admin.id);
  });

  // The two exclusion flags default to «участвует» — an existing roster must not
  // silently lose anybody the moment this migration runs.
  it("defaults both exclusion flags to false for a new employee", () => {
    const db = makeTestDb();
    const person = createEmployee(db, { displayName: "Аня Смирнова" });
    expect(person.excludedFromAssignment).toBe(false);
    expect(person.excludedFromSwaps).toBe(false);
  });
});
