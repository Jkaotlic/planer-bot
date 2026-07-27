import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0008_team_schedule_identity.sql", import.meta.url),
  "utf8",
);

describe("0008_team_schedule_identity", () => {
  it("renames preset 6 and its stored titles without breaking template references", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE shift_templates (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        is_active INTEGER NOT NULL
      );
      CREATE TABLE shifts (
        id INTEGER PRIMARY KEY,
        template_id INTEGER REFERENCES shift_templates(id),
        title TEXT
      );
      INSERT INTO shift_templates VALUES (6, 'Открытие', 'shift', 1);
      INSERT INTO shifts VALUES (41, 6, 'Открытие');
      INSERT INTO shifts VALUES (42, 6, 'Своё название');
    `);

    sqlite.exec(migration);

    expect(
      sqlite.prepare("SELECT id, name, category, is_active FROM shift_templates WHERE id = 6").get(),
    ).toEqual({
      id: 6,
      name: "Дежурство с 07:00",
      category: "duty",
      is_active: 1,
    });
    expect(sqlite.prepare("SELECT id, template_id, title FROM shifts ORDER BY id").all()).toEqual([
      { id: 41, template_id: 6, title: "Дежурство с 07:00" },
      { id: 42, template_id: 6, title: "Своё название" },
    ]);
  });
});
