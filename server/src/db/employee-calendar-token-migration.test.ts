import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, runMigrations } from "./client";
import { makeTestDb } from "./testdb";
import { employees } from "./schema";
import { createEmployee } from "../repo/employees";

describe("0035_employee_calendar_token", () => {
  it("после миграции у employees есть calendar_token", () => {
    const { db, sqlite } = openDb(":memory:");
    runMigrations(db, sqlite);
    const columns = (sqlite.prepare("SELECT name FROM pragma_table_info('employees')").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toContain("calendar_token");
    sqlite.close();
  });

  it("два одинаковых токена — ошибка уникальности, а не тихая перезапись", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    db.update(employees).set({ calendarToken: "same-token" }).where(eq(employees.id, a.id)).run();
    expect(() =>
      db.update(employees).set({ calendarToken: "same-token" }).where(eq(employees.id, igor.id)).run(),
    ).toThrow(/unique/i);
  });
});
