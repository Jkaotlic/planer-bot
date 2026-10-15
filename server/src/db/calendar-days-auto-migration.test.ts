import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0044_calendar_days_auto.sql", import.meta.url), "utf8");

/** Таблица в форме прода до миграции: авто-строка и ручная поверх праздника. */
function staged() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE calendar_days (date TEXT PRIMARY KEY, kind TEXT NOT NULL, note TEXT,
      source TEXT DEFAULT 'auto' NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO calendar_days VALUES ('2026-06-12', 'holiday', 'День России', 'auto', 1);
    INSERT INTO calendar_days VALUES ('2026-11-04', 'workday', 'работаем', 'manual', 2);
  `);
  return sqlite;
}

describe("0044_calendar_days_auto", () => {
  it("добавляет auto_kind/auto_note, старые строки не теряют ничего", () => {
    const sqlite = staged();
    for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement);
    expect(sqlite.prepare("SELECT * FROM calendar_days ORDER BY date").all()).toEqual([
      { date: "2026-06-12", kind: "holiday", note: "День России", source: "auto", updated_at: 1, auto_kind: null, auto_note: null },
      { date: "2026-11-04", kind: "workday", note: "работаем", source: "manual", updated_at: 2, auto_kind: null, auto_note: null },
    ]);
  });

  it("только ADD COLUMN — таблица не пересоздаётся", () => {
    const statements = migration.replace(/^--.*$/gm, "").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const s of statements) expect(s).toMatch(/^ALTER TABLE `calendar_days` ADD `auto_(kind|note)` text;$/);
  });
});
