import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const sqlOf = (prefix: string) => {
  const file = readdirSync(migrationsDir).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`migration ${prefix} not found`);
  return readFileSync(join(migrationsDir, file), "utf8");
};

function seed(sqlite: Database.Database) {
  sqlite.exec(sqlOf("0000"));
  sqlite.pragma("foreign_keys = ON");
  sqlite.prepare("INSERT INTO shifts (date, start, \"end\") VALUES ('2026-07-01','08:00','17:00')").run();
  sqlite.prepare("INSERT INTO reminder_log (shift_id, kind) VALUES (1, 'evening_before')").run();
}

describe("migration 0001 FK-safety on populated data", () => {
  it("would FAIL if applied (in a transaction) with FK enforcement on — the bug the guard prevents", () => {
    const sqlite = new Database(":memory:");
    seed(sqlite);
    // migrate() runs in a transaction; the file's own PRAGMA foreign_keys=OFF is a no-op there,
    // so with FK on, DROP TABLE shifts trips the reminder_log FK.
    const applyInTxn = sqlite.transaction(() => sqlite.exec(sqlOf("0001")));
    expect(() => applyInTxn()).toThrow();
  });

  it("SUCCEEDS with child rows preserved when FK enforcement is disabled first (what runMigrations now does)", () => {
    const sqlite = new Database(":memory:");
    seed(sqlite);
    sqlite.pragma("foreign_keys = OFF");
    const applyInTxn = sqlite.transaction(() => sqlite.exec(sqlOf("0001")));
    expect(() => applyInTxn()).not.toThrow();
    sqlite.pragma("foreign_keys = ON");
    const shift = sqlite.prepare("SELECT category FROM shifts WHERE id = 1").get() as { category: string };
    expect(shift.category).toBe("shift"); // recreated with the new default
    expect((sqlite.prepare("SELECT count(*) AS c FROM reminder_log").get() as { c: number }).c).toBe(1); // child survived
  });
});
