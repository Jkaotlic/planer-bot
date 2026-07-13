import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { employees, shifts } from "./schema";

describe("db client", () => {
  it("migrates an in-memory db so tables are usable", () => {
    const db = makeTestDb();
    const inserted = db.insert(employees).values({ displayName: "Аня" }).returning().all();
    expect(inserted[0]!.id).toBeGreaterThan(0);
    expect(inserted[0]!.displayName).toBe("Аня");
    expect(inserted[0]!.isActive).toBe(true); // default applied
  });

  it("enforces foreign keys (a shift with a nonexistent employee is rejected)", () => {
    const db = makeTestDb();
    expect(() =>
      db.insert(shifts).values({ date: "2026-07-01", start: "08:00", end: "17:00", employeeId: 9999 }).run(),
    ).toThrow();
  });
});
