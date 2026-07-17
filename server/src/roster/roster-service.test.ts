import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, listActive, archiveEmployee } from "../repo/employees";
import { listShiftsInRange, createShift } from "../repo/shifts";
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

/** Pull one person's codes (in date order) out of a buildRosterCsv() result. */
function rowFor(csv: string, name: string): string[] {
  const lines = csv.trim().split(/\r\n/);
  const row = lines.find((l) => l.startsWith(`${name};`));
  if (!row) throw new Error(`row not found for ${name}`);
  return row.split(";").slice(1);
}

describe("buildRosterCsv", () => {
  it("exports a covering entry the vocabulary can't express as '?', never as 'holiday'", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Рыночный Игорь" });
    // weekend-service creates real timed weekend_work shifts with no templateId (§ Finding 1).
    createShift(db, { date: "2026-07-06", start: "10:00", end: "19:00", category: "weekend_work", templateId: null, employeeId: w.id });

    const csv = buildRosterCsv(db, "2026-07-06", "2026-07-07");
    const codes = rowFor(csv, "Рыночный Игорь");
    expect(codes[0]).toBe("?");        // worked — must not be masked as a day off
    expect(codes[1]).toBe("holiday");  // genuinely no covering entry
  });

  it("listShiftsOverlapping paints a multi-day absence that started before the export window", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Отпускник Олег" });
    // Vacation spans May 28 -> Jun 2; the export window starts mid-span.
    createShift(db, { date: "2026-05-28", endDate: "2026-06-02", category: "vacation", employeeId: w.id });

    const csv = buildRosterCsv(db, "2026-06-01", "2026-06-03");
    const codes = rowFor(csv, "Отпускник Олег");
    expect(codes).toEqual(["otp", "otp", "holiday"]); // 06-01, 06-02 still in the vacation; 06-03 is free
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

  it("round-trips the file's row order even when the renamed people already hold low ids", () => {
    const db = makeTestDb();
    // The live shape: five nickname users already exist, so their ids (1,2,4,5,6) do NOT
    // match their positions in the file. Without rosterOrder the export reorders the rows.
    const nick = (name: string, tg: number) => {
      const e = createEmployee(db, { displayName: name, inviteToken: `inv-${tg}` });
      linkTelegramAccount(db, `inv-${tg}`, tg);
      return e;
    };
    const orlov = nick("Andrey Test", 100000001);
    const titov = nick("Миша Тест", 100000002);
    const testAccount = nick("__TEST Проверка", 999999); // archived-ish extra, never in the file
    const gushchin = nick("Кирилл Тест", 100000003);
    const panov = nick("Женя Тест", 100000004);
    const safonov = nick("Михаил Тест", 100000005);
    archiveEmployee(db, testAccount.id, "2026-06-01");

    const source = readFileSync(FILE, "utf8");
    const decoded = decodeRoster(parseRosterCsv(source), listActiveTemplates(db));
    const renames: Record<string, number> = {
      "Орлов Андрей": orlov.id, "Титов Михаил": titov.id, "Гущин Кирилл": gushchin.id,
      "Панов Евгений": panov.id, "Сафонов Михаил": safonov.id,
    };
    const resolutions = decoded.perPerson.map((p) =>
      p.name in renames
        ? { csvName: p.name, action: "rename" as const, employeeId: renames[p.name]! }
        : { csvName: p.name, action: "create" as const });
    applyRosterImport(db, decoded, resolutions, null);

    const exported = "﻿" + buildRosterCsv(db, "2026-06-01", "2026-06-30");
    const normalize = (s: string) =>
      s.replace(/\r\n/g, "\n").trim().replace("Хохлов Дмитрий;k32;k32;Нет;", "Хохлов Дмитрий;k32;k32;holiday;");
    expect(normalize(exported)).toBe(normalize(source));
  });
});
