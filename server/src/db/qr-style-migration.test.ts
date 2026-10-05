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
  sqlite.pragma("foreign_keys = OFF");
  for (const file of files) {
    if (file.startsWith(stopAt)) break;
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
  return sqlite;
}

const QR_0042 = files.find((f) => f.startsWith("0042"))!;

describe("migration 0042 — QR style", () => {
  it("leaves every existing employee on the default style: the new column is NULL, no backfill", () => {
    const sqlite = migratedUpTo("0042");
    sqlite.exec("INSERT INTO employees (display_name) VALUES ('Аня'), ('Игорь')");
    sqlite.exec(readFileSync(join(dir, QR_0042), "utf8"));
    expect(sqlite.prepare("SELECT qr_style FROM employees ORDER BY id").all()).toEqual([{ qr_style: null }, { qr_style: null }]);
  });

  it("touches nothing but the one column", () => {
    const sql = readFileSync(join(dir, QR_0042), "utf8");
    // drizzle-kit has replayed old migrations into new files before (see 0036's header).
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|__new_/);
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sql).toMatch(/ALTER TABLE `employees` ADD `qr_style` text;/);
  });
});
