import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0033_checklist_templates.sql", import.meta.url),
  "utf8",
);

/**
 * Мини-база в форме прода на 2026-09-01: два чек-листа, четыре вида смен, из
 * которых два ссылаются на список 3, и `reminder_log` с сегодняшними пометками
 * старого образца.
 */
function staged() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE checklists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE shift_templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      checklist_id INTEGER REFERENCES checklists(id)
    );
    CREATE TABLE shifts (id INTEGER PRIMARY KEY, template_id INTEGER REFERENCES shift_templates(id));
    CREATE TABLE reminder_log (
      id INTEGER PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      kind TEXT NOT NULL,
      sent_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO checklists VALUES (1, 'Дежурства 47'), (3, 'Обход этажа');
    INSERT INTO shift_templates (id, name, checklist_id) VALUES
      (1, 'Утро', 3), (2, 'День', NULL), (6, 'Дежурство с 07:00', 3), (7, 'Вечер', NULL);
    INSERT INTO shifts VALUES (100, 6), (101, 2);
    INSERT INTO reminder_log (id, shift_id, kind) VALUES
      (1, 100, 'duty_checklist'), (2, 100, 'evening_before'), (3, 101, 'duty_checklist');
  `);
  return sqlite;
}

describe("0033_checklist_templates", () => {
  it("переносит привязки из колонки в таблицу связей", () => {
    const sqlite = staged();
    sqlite.exec(migration);
    expect(
      sqlite.prepare("SELECT checklist_id, template_id FROM checklist_templates ORDER BY template_id").all(),
    ).toEqual([
      { checklist_id: 3, template_id: 1 },
      { checklist_id: 3, template_id: 6 },
    ]);
  });

  it("убирает колонку, чтобы правда о привязке осталась одна", () => {
    const sqlite = staged();
    sqlite.exec(migration);
    const columns = (sqlite.prepare("SELECT name FROM pragma_table_info('shift_templates')").all() as { name: string }[])
      .map((c) => c.name);
    expect(columns).not.toContain("checklist_id");
  });

  /**
   * Пометка «уже уходило» становится пер-списочной. Без переименования
   * сегодняшние дежурные получили бы своё сообщение второй раз: новый тик
   * искал бы `duty_checklist:3` и не нашёл бы ничего.
   */
  it("переименовывает сегодняшние пометки в пер-списочные", () => {
    const sqlite = staged();
    sqlite.exec(migration);
    expect(sqlite.prepare("SELECT id, kind FROM reminder_log ORDER BY id").all()).toEqual([
      { id: 1, kind: "duty_checklist:3" },
      { id: 2, kind: "evening_before" },
      // Смена вида без чек-листа: пометке неоткуда взять id, и трогать её
      // нечем. Такой строки в проде быть не должно, но молча портить её в
      // `duty_checklist:` без числа — хуже, чем оставить как есть.
      { id: 3, kind: "duty_checklist" },
    ]);
  });
});
