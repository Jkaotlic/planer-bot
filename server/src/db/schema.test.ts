import { describe, it, expect } from "vitest";
import { employees, shifts, shiftTemplates, swapRequests, reminderLog, auditLog } from "./schema";
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
});
