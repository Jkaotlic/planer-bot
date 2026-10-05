import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** Every migration up to (not including) `stopAt`, the way `runMigrations` applies them. */
function migratedUpTo(stopAt: string): Database.Database {
  const sqlite = new Database(":memory:");
  // Same as `runMigrations`: table-recreating migrations need FK enforcement off.
  sqlite.pragma("foreign_keys = OFF");
  for (const file of files) {
    if (file.startsWith(stopAt)) break;
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
  return sqlite;
}

const SICK_0041 = files.find((f) => f.startsWith("0041"))!;

describe("migration 0041 — sick leave approval", () => {
  it("leaves every existing sick leave approved: all new columns are NULL, no backfill", () => {
    const sqlite = migratedUpTo("0041");
    sqlite.exec("INSERT INTO shifts (date, end_date, category) VALUES ('2026-10-06', '2026-10-08', 'sick_leave')");
    sqlite.exec(readFileSync(join(dir, SICK_0041), "utf8"));
    expect(
      sqlite.prepare("SELECT approval_requested_at, approved_by_employee_id, handover_forced_at, approved_date, approved_end_date FROM shifts").all(),
    ).toEqual([
      { approval_requested_at: null, approved_by_employee_id: null, handover_forced_at: null, approved_date: null, approved_end_date: null },
    ]);
  });

  it("drops a message row with its sick leave and nulls the approver when the employee row goes", () => {
    const sqlite = migratedUpTo("0041");
    sqlite.exec(readFileSync(join(dir, SICK_0041), "utf8"));
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec("INSERT INTO employees (display_name) VALUES ('Игорь')");
    sqlite.exec("INSERT INTO shifts (date, category, approved_by_employee_id) VALUES ('2026-10-06', 'sick_leave', 1)");
    sqlite.exec("INSERT INTO sick_leave_approval_messages (shift_id, chat_id, message_id) VALUES (1, 111, 5)");

    sqlite.exec("DELETE FROM employees WHERE id = 1");
    expect(sqlite.prepare("SELECT approved_by_employee_id AS by FROM shifts").get()).toEqual({ by: null });

    sqlite.exec("DELETE FROM shifts WHERE id = 1");
    expect(sqlite.prepare("SELECT count(*) AS c FROM sick_leave_approval_messages").get()).toEqual({ c: 0 });
  });

  it("touches nothing but the five columns, the index and the new table", () => {
    const sql = readFileSync(join(dir, SICK_0041), "utf8");
    // drizzle-kit has replayed old migrations into new files before (see 0036's header);
    // a second CREATE TABLE of an existing table would take the deploy down.
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).not.toMatch(/__new_shifts|DROP TABLE/);
  });
});
