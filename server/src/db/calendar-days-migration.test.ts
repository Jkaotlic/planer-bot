import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0034_calendar_days_source.sql", import.meta.url), "utf8");

/** Таблица в форме прода до миграции: три колонки, одна строка, поставленная руками. */
function staged() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE calendar_days (date TEXT PRIMARY KEY, kind TEXT NOT NULL, note TEXT);
    INSERT INTO calendar_days VALUES ('2026-06-12', 'holiday', 'День России');
  `);
  return sqlite;
}

describe("0034_calendar_days_source", () => {
  it("добавляет source и updated_at, старые строки считаются автоматическими", () => {
    const sqlite = staged();
    for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement);
    const row = sqlite.prepare("SELECT * FROM calendar_days").get() as { source: string; updated_at: number };
    expect(row.source).toBe("auto");
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it("повторный прогон падает громко, а не портит таблицу", () => {
    const sqlite = staged();
    for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement);
    expect(() => sqlite.exec(migration.split("--> statement-breakpoint")[0]!)).toThrow(/duplicate column/i);
  });
});
