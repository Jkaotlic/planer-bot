import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, listActive } from "../repo/employees";
import { listShiftsInRange } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { listActiveTemplates } from "../repo/templates";
import { applyRosterImport, buildRosterCsv, type PersonResolution } from "./roster-service";
import { parseRosterCsv, decodeRoster, type DecodeResult } from "./roster-codec";

function decode(perPerson: DecodeResult["perPerson"]): DecodeResult {
  return { perPerson, unknowns: [], proposedHolidays: [] };
}

describe("applyRosterImport", () => {
  it("renames an existing nickname user (keeping Telegram) and creates the rest", () => {
    const db = makeTestDb();
    const bot = createEmployee(db, { displayName: "Женя Тест", inviteToken: "inv-1" });
    linkTelegramAccount(db, "inv-1", 555, "demo_worker3");

    const decoded = decode([
      { name: "Панов Евгений", entries: [{ date: "2026-06-01", endDate: null, category: "duty", templateId: 7, location: null, start: "09:00", end: "18:00", title: "Дежурство · Телефон" }] },
      { name: "Новиков Пётр", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [
      { csvName: "Панов Евгений", action: "rename", employeeId: bot.id },
      { csvName: "Новиков Пётр", action: "create" },
    ];

    const summary = applyRosterImport(db, decoded, resolutions, null); // actor null — audit.actorEmployeeId is a nullable FK; a bogus id would trip foreign_keys=ON
    expect(summary).toMatchObject({ employeesRenamed: 1, employeesCreated: 1, entriesInserted: 2 });

    const renamed = getEmployeeById(db, bot.id)!;
    expect(renamed.displayName).toBe("Панов Евгений");
    expect(renamed.telegramUserId).toBe(555); // link preserved — the whole point

    expect(listActive(db).map((e) => e.displayName).sort()).toEqual(["Панов Евгений", "Новиков Пётр"]);
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(2);
    expect(listRecentAudit(db, 10).filter((a) => a.type === "roster_import")).toHaveLength(1);
  });

  it("is atomic: a row that fails createEntrySchema rolls the whole import back", () => {
    const db = makeTestDb();
    const before = listActive(db).length;
    const decoded = decode([
      // start present but end missing -> countsForBalance('shift') requires both -> createEntrySchema rejects.
      { name: "Плохой Ряд", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: null, title: "День" }] },
    ]);
    expect(() => applyRosterImport(db, decoded, [{ csvName: "Плохой Ряд", action: "create" }], null)).toThrow(/2026-06-01/);
    expect(listActive(db).length).toBe(before);       // no employee created
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(0); // no shift inserted
  });

  it("throws if a decoded person has no resolution", () => {
    const db = makeTestDb();
    const decoded = decode([{ name: "Без Карты", entries: [] }]);
    expect(() => applyRosterImport(db, decoded, [], null)).toThrow(/Без Карты/);
  });
});

const FILE = "/Users/user/Downloads/Дежурства 2026.csv";

describe("roster round-trip", () => {
  it("import June then export gives back the source matrix (bar the one 'Нет' cell)", () => {
    const db = makeTestDb();
    const source = readFileSync(FILE, "utf8");
    const decoded = decodeRoster(parseRosterCsv(source), listActiveTemplates(db));
    // Reconcile everyone as 'create' (fresh DB has no employees yet).
    const resolutions = decoded.perPerson.map((p) => ({ csvName: p.name, action: "create" as const }));
    applyRosterImport(db, decoded, resolutions, null);

    const exported = "﻿" + buildRosterCsv(db, "2026-06-01", "2026-06-30");

    // The only expected difference: Хохлов/03.06 was 'Нет' (undecodable, not stored) -> exports as 'holiday'.
    const normalize = (s: string) =>
      s.replace(/\r\n/g, "\n").trim().replace("Хохлов Дмитрий;k32;k32;Нет;", "Хохлов Дмитрий;k32;k32;holiday;");
    expect(normalize(exported)).toBe(normalize(source));
  });
});
