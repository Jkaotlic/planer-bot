import { describe, it, expect } from "vitest";
import { employees, shifts, shiftTemplates, swapRequests, reminderLog, auditLog } from "./schema";
import { getTableConfig } from "drizzle-orm/sqlite-core";

describe("schema", () => {
  it("declares all six tables with expected sqlite names", () => {
    expect(getTableConfig(employees).name).toBe("employees");
    expect(getTableConfig(shiftTemplates).name).toBe("shift_templates");
    expect(getTableConfig(shifts).name).toBe("shifts");
    expect(getTableConfig(swapRequests).name).toBe("swap_requests");
    expect(getTableConfig(reminderLog).name).toBe("reminder_log");
    expect(getTableConfig(auditLog).name).toBe("audit_log");
  });

  it("maps camelCase keys to snake_case columns", () => {
    const cols = getTableConfig(employees).columns.map((c) => c.name);
    expect(cols).toContain("telegram_user_id");
    expect(cols).toContain("display_name");
    expect(cols).toContain("prep_buffer_min");
  });

  it("declares one index on reminder_log (uniqueness verified in the migration SQL, Task 3)", () => {
    expect(getTableConfig(reminderLog).indexes.length).toBe(1);
  });
});
