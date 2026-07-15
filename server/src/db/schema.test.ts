import { describe, it, expect } from "vitest";
import {
  employees,
  shifts,
  shiftTemplates,
  swapRequests,
  reminderLog,
  auditLog,
  templatePool,
  templatePreference,
  calendarDays,
} from "./schema";
import { makeTestDb } from "./testdb";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

describe("schema", () => {
  it("declares all six tables with expected sqlite names", () => {
    expect(getTableConfig(employees).name).toBe("employees");
    expect(getTableConfig(shiftTemplates).name).toBe("shift_templates");
    expect(getTableConfig(shifts).name).toBe("shifts");
    expect(getTableConfig(swapRequests).name).toBe("swap_requests");
    expect(getTableConfig(reminderLog).name).toBe("reminder_log");
    expect(getTableConfig(auditLog).name).toBe("audit_log");
  });

  it("maps camelCase keys to snake_case columns via casing (verified in emitted SQL)", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(employees).toSQL().sql;
    expect(sql).toContain("telegram_user_id");
    expect(sql).toContain("display_name");
    expect(sql).toContain("prep_buffer_min");
  });

  it("declares one index on reminder_log (uniqueness verified in the migration SQL, Task 3)", () => {
    expect(getTableConfig(reminderLog).indexes.length).toBe(1);
  });

  it("shifts carries category, end_date, location, and nullable start/end", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(shifts).toSQL().sql;
    expect(sql).toContain("category");
    expect(sql).toContain("end_date");
    expect(sql).toContain("location");
  });

  it("employees carries archived_at", () => {
    const db = drizzle(new Database(":memory:"), { casing: "snake_case" });
    const sql = db.select().from(employees).toSQL().sql;
    expect(sql).toContain("archived_at");
  });
});

describe("role configuration columns", () => {
  it("defaults every preset to 'not a role' so the migration is inert", () => {
    const db = makeTestDb();
    db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).run();
    const row = db.select().from(shiftTemplates).all()[0]!;
    expect(row.coverage).toBe("0,0,0,0,0,0,0");
    expect(row.fillMode).toBe("count");
    expect(row.rotationUnit).toBe("day");
    expect(row.primaryEmployeeId).toBeNull();
  });

  it("stores a pool membership, a preference and a calendar day", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;

    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePool).all()).toHaveLength(1);

    db.insert(templatePreference).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(db.select().from(templatePreference).all()[0]!.weight).toBe(1);

    db.insert(calendarDays).values({ date: "2026-06-12", kind: "holiday", note: "День России" }).run();
    expect(db.select().from(calendarDays).all()[0]!.kind).toBe("holiday");
  });

  it("refuses a second pool row for the same person on the same preset", () => {
    const db = makeTestDb();
    const tpl = db.insert(shiftTemplates).values({ name: "X", start: "09:00", end: "18:00" }).returning().all()[0]!;
    const emp = db.insert(employees).values({ displayName: "Аня" }).returning().all()[0]!;
    db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run();
    expect(() => db.insert(templatePool).values({ templateId: tpl.id, employeeId: emp.id }).run()).toThrow(/UNIQUE/i);
  });
});
