import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { employees } from "./schema";

describe("db client", () => {
  it("migrates an in-memory db so tables are usable", () => {
    const db = makeTestDb();
    const inserted = db.insert(employees).values({ displayName: "Аня" }).returning().all();
    expect(inserted[0]!.id).toBeGreaterThan(0);
    expect(inserted[0]!.displayName).toBe("Аня");
    expect(inserted[0]!.isActive).toBe(true); // default applied
  });
});
