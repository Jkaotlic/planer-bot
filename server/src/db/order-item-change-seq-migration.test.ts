import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../drizzle/0045_order_item_change_seq.sql", import.meta.url), "utf8");

/** Таблица в форме прода до миграции: две позиции одного человека. */
function staged() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE food_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL, menu_item_id INTEGER, name TEXT NOT NULL, price INTEGER NOT NULL,
      qty INTEGER DEFAULT 1 NOT NULL, unit TEXT DEFAULT 'pcs' NOT NULL, step_grams INTEGER, created_at INTEGER NOT NULL);
    INSERT INTO food_order_items VALUES (1, 1, 2, 5, 'Шаурма', 350, 2, 'pcs', NULL, 1);
    INSERT INTO food_order_items VALUES (2, 1, 2, 6, 'Икра кетовая', 2400, 3, 'kg', 400, 2);
  `);
  return sqlite;
}

describe("0045_order_item_change_seq", () => {
  it("добавляет change_seq = 0, старые строки не теряют ничего", () => {
    const sqlite = staged();
    for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement);
    expect(sqlite.prepare("SELECT id, qty, unit, step_grams, change_seq FROM food_order_items ORDER BY id").all()).toEqual([
      { id: 1, qty: 2, unit: "pcs", step_grams: null, change_seq: 0 },
      { id: 2, qty: 3, unit: "kg", step_grams: 400, change_seq: 0 },
    ]);
  });

  it("только ADD COLUMN — таблица не пересоздаётся", () => {
    const statements = migration.replace(/^--.*$/gm, "").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual(["ALTER TABLE `food_order_items` ADD `change_seq` integer DEFAULT 0 NOT NULL;"]);
  });
});
