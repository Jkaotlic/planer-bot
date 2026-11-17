import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("0047 сохраняет отметки действующего назначения и не приписывает ничьи отметки новому дежурному", () => {
  const migration = readFileSync(new URL("../../drizzle/0047_checklist_delivery_recipient.sql", import.meta.url), "utf8");
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE shifts (id INTEGER PRIMARY KEY, date TEXT NOT NULL, employee_id INTEGER);
      CREATE TABLE reminder_log (
        id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL, kind TEXT NOT NULL, sent_at INTEGER NOT NULL,
        UNIQUE (shift_id, kind)
      );
      INSERT INTO shifts VALUES (1, '2026-11-17', 7), (2, '2026-11-17', NULL);
      INSERT INTO reminder_log VALUES
        (1, 1, 'duty_checklist:5', 10),
        (2, 1, 'duty_checklist_doc:5@2026-11-18', 20),
        (3, 1, 'duty_checklist_undeliverable:8', 30),
        (4, 1, 'evening_before:7', 40),
        (5, 2, 'duty_checklist:5', 50),
        (6, 1, 'duty_checklist:5@2026-11-17', 60);
    `);
    const entries = sqlite.prepare("SELECT kind, sent_at FROM reminder_log ORDER BY id");
    sqlite.exec(migration);
    sqlite.exec(migration);
    expect(entries.all()).toEqual([
      { kind: "duty_checklist:5", sent_at: 10 },
      { kind: "duty_checklist_doc:5@2026-11-18", sent_at: 20 },
      { kind: "duty_checklist_undeliverable:8", sent_at: 30 },
      { kind: "evening_before:7", sent_at: 40 },
      { kind: "duty_checklist:5", sent_at: 50 },
      { kind: "duty_checklist:5@2026-11-17", sent_at: 60 },
      { kind: "duty_checklist:5@2026-11-17#7", sent_at: 10 },
      { kind: "duty_checklist_doc:5@2026-11-18#7", sent_at: 20 },
      { kind: "duty_checklist_undeliverable:8@2026-11-17#7", sent_at: 30 },
    ]);
  } finally {
    sqlite.close();
  }
});
