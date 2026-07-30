import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, listActive, archiveEmployee, reorderEmployee } from "../repo/employees";
import { listShiftsInRange, createShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { applyRosterImport, buildRosterCsv, RosterImportConflictError, type PersonResolution } from "./roster-service";
import type { DecodeResult } from "./roster-codec";
import { swapRequests } from "../db/schema";

function decode(perPerson: DecodeResult["perPerson"]): DecodeResult {
  return { perPerson, unknowns: [], preserved: [], proposedHolidays: [] };
}

/** A plain timed 'День' entry — the shape the codec both writes and can encode back. */
const dayShift = (date: string) => ({
  date, endDate: null, category: "shift" as const, templateId: 2,
  location: null, start: "09:00", end: "18:00", title: "День",
});

describe("applyRosterImport", () => {
  it("renames an existing nickname user (keeping Telegram) and creates the rest", () => {
    const db = makeTestDb();
    const bot = createEmployee(db, { displayName: "Женя Тест", inviteToken: "inv-1" });
    linkTelegramAccount(db, "inv-1", 555, "test_worker");

    const decoded = decode([
      { name: "Сидоров Евгений", entries: [{ date: "2026-06-01", endDate: null, category: "duty", templateId: 7, location: null, start: "09:00", end: "18:00", title: "Дежурство · Телефон" }] },
      { name: "Новиков Пётр", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [
      { csvName: "Сидоров Евгений", action: "rename", employeeId: bot.id },
      { csvName: "Новиков Пётр", action: "create" },
    ];

    const summary = applyRosterImport(db, decoded, resolutions, null); // actor null — audit.actorEmployeeId is a nullable FK; a bogus id would trip foreign_keys=ON
    expect(summary).toMatchObject({ employeesRenamed: 1, employeesCreated: 1, entriesInserted: 2 });

    const renamed = getEmployeeById(db, bot.id)!;
    expect(renamed.displayName).toBe("Сидоров Евгений");
    expect(renamed.telegramUserId).toBe(555); // link preserved — the whole point

    expect(listActive(db).map((e) => e.displayName).sort()).toEqual(["Новиков Пётр", "Сидоров Евгений"]);
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

  it("a second import over the same span throws instead of doubling every entry", () => {
    const db = makeTestDb();
    const decoded = decode([
      { name: "Один Человек", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [{ csvName: "Один Человек", action: "create" }];

    applyRosterImport(db, decoded, resolutions, null); // first import succeeds
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(1);

    expect(() => applyRosterImport(db, decoded, resolutions, null)).toThrow(/2026-06-01\.\.2026-06-01/);
    // Nothing doubled — the transaction rolled back the second attempt entirely.
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(1);
    expect(listActive(db)).toHaveLength(1);
  });

  it("reports the conflict as a typed error carrying the count and span", () => {
    const db = makeTestDb();
    const decoded = decode([{ name: "Один Человек", entries: [dayShift("2026-06-01")] }]);
    const resolutions: PersonResolution[] = [{ csvName: "Один Человек", action: "create" }];
    applyRosterImport(db, decoded, resolutions, null);

    try {
      applyRosterImport(db, decoded, resolutions, null);
      expect.unreachable("second import must conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(RosterImportConflictError);
      const conflict = err as RosterImportConflictError;
      expect(conflict.existingCount).toBe(1);
      expect(conflict.from).toBe("2026-06-01");
      expect(conflict.to).toBe("2026-06-01");
    }
  });

  it("overwrite replaces the month's encodable entries instead of refusing", () => {
    const db = makeTestDb();
    const decoded = decode([{ name: "Один Человек", entries: [dayShift("2026-06-01")] }]);
    const resolutions: PersonResolution[] = [{ csvName: "Один Человек", action: "create" }];
    applyRosterImport(db, decoded, resolutions, null);
    const first = listShiftsInRange(db, "2026-06-01", "2026-06-01");
    expect(first).toHaveLength(1);

    // Same person, same day, but now an evening shift — the rename path reuses the
    // employee created by the first import, so nobody is duplicated.
    const second = decode([{
      name: "Один Человек",
      entries: [{ ...dayShift("2026-06-01"), templateId: 4, title: "Вечер", start: "11:00", end: "20:00" }],
    }]);
    const summary = applyRosterImport(
      db, second, [{ csvName: "Один Человек", action: "rename", employeeId: first[0]!.employeeId! }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-01" } },
    );

    expect(summary.entriesDeleted).toBe(1);
    expect(summary.entriesInserted).toBe(1);
    const after = listShiftsInRange(db, "2026-06-01", "2026-06-01");
    expect(after).toHaveLength(1);
    expect(after[0]!.title).toBe("Вечер");
    expect(listActive(db)).toHaveLength(1); // no duplicate person
  });

  // Same rule as deleting a single entry: the file replacing a month doesn't get to
  // pretend the swaps on it never happened. Re-importing used to DELETE the rows.
  it("overwrite expires the swaps on the entries it replaces, keeping resolved ones", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Первый Работник" });
    const b = createEmployee(db, { displayName: "Второй Работник" });
    const sa = createShift(db, { ...dayShift("2026-06-01"), employeeId: a.id });
    const sb = createShift(db, { ...dayShift("2026-06-02"), employeeId: b.id });
    const pending = db.insert(swapRequests)
      .values({ fromEmployeeId: a.id, fromShiftId: sa.id, toEmployeeId: b.id, toShiftId: sb.id })
      .returning().all()[0]!;
    const done = db.insert(swapRequests)
      .values({ fromEmployeeId: b.id, fromShiftId: sb.id, toEmployeeId: a.id, toShiftId: sa.id, status: "accepted" })
      .returning().all()[0]!;

    const decoded = decode([{ name: "Первый Работник", entries: [dayShift("2026-06-01")] }]);
    const result = applyRosterImport(
      db, decoded, [{ csvName: "Первый Работник", action: "rename", employeeId: a.id }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-30" } },
    );

    expect(result.swapsExpired).toBe(1);
    expect(result.expiredSwaps.map((p) => p.requestId)).toEqual([pending.id]);
    // Both rows are still there; only the pending one changed state.
    const rows = db.select().from(swapRequests).all();
    expect(rows.map((r) => r.id).sort()).toEqual([pending.id, done.id].sort());
    expect(rows.find((r) => r.id === pending.id)!.status).toBe("expired");
    expect(rows.find((r) => r.id === done.id)!.status).toBe("accepted");
    expect(rows.every((r) => r.fromShiftId === null && r.toShiftId === null)).toBe(true);
    // The line was captured before the entry went away, so the notice can still name it.
    expect(result.expiredSwaps[0]!.fromShift).not.toBe("смену");
  });

  it("overwrite keeps entries the CSV cannot express — weekend work survives a re-import", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Рыночный Игорь" });
    // A real weekend_work entry (no templateId) — exports as '?', so the CSV can't recreate it.
    createShift(db, { date: "2026-06-06", start: "10:00", end: "19:00", category: "weekend_work", templateId: null, employeeId: w.id });
    createShift(db, { ...dayShift("2026-06-01"), employeeId: w.id });
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-30")).toHaveLength(2);

    const decoded = decode([{ name: "Рыночный Игорь", entries: [dayShift("2026-06-02")] }]);
    const summary = applyRosterImport(
      db, decoded, [{ csvName: "Рыночный Игорь", action: "rename", employeeId: w.id }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-30" } },
    );

    expect(summary.entriesDeleted).toBe(1); // only the encodable 'День' went
    const after = listShiftsInRange(db, "2026-06-01", "2026-06-30");
    expect(after.map((s) => s.category).sort()).toEqual(["shift", "weekend_work"]);
    expect(after.find((s) => s.category === "weekend_work")!.date).toBe("2026-06-06");
  });

  it("overwrite refuses when an existing range reaches outside the file's span", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Отпускник Олег" });
    // Vacation 28 May -> 2 June. A June-only file has no authority over May, and
    // deleting the row would take May with it.
    createShift(db, { date: "2026-05-28", endDate: "2026-06-02", category: "vacation", employeeId: w.id });

    expect(() => applyRosterImport(
      db, decode([{ name: "Отпускник Олег", entries: [dayShift("2026-06-10")] }]),
      [{ csvName: "Отпускник Олег", action: "rename", employeeId: w.id }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-30" } },
    )).toThrow(/Отпускник Олег.*2026-05-28/);

    // Nothing touched: the vacation is intact and no new entry landed.
    expect(listShiftsInRange(db, "2026-05-28", "2026-06-30")).toHaveLength(1);
  });

  it("overwrite records what it removed in the audit trail", () => {
    const db = makeTestDb();
    const decoded = decode([{ name: "Один Человек", entries: [dayShift("2026-06-01")] }]);
    applyRosterImport(db, decoded, [{ csvName: "Один Человек", action: "create" }], null);
    const employeeId = listActive(db)[0]!.id;

    applyRosterImport(
      db, decoded, [{ csvName: "Один Человек", action: "rename", employeeId }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-01" } },
    );

    const imports = listRecentAudit(db, 10).filter((a) => a.type === "roster_import");
    expect(imports).toHaveLength(2);
    expect(imports[0]!.payload).toMatchObject({ overwrite: true, entriesDeleted: 1, entriesInserted: 1 });
  });

  it("an explicit span makes an empty CSV still clear the month it covers", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Пустой Месяц" });
    createShift(db, { ...dayShift("2026-06-15"), employeeId: w.id });

    const summary = applyRosterImport(
      db, decode([{ name: "Пустой Месяц", entries: [] }]),
      [{ csvName: "Пустой Месяц", action: "rename", employeeId: w.id }], null,
      { overwrite: true, span: { from: "2026-06-01", to: "2026-06-30" } },
    );

    expect(summary.entriesDeleted).toBe(1);
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-30")).toHaveLength(0);
  });

  it("throws if a rename targets a non-existent employeeId, and writes nothing", () => {
    const db = makeTestDb();
    const decoded = decode([
      { name: "Призрак Иван", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [{ csvName: "Призрак Иван", action: "rename", employeeId: 999 }];

    expect(() => applyRosterImport(db, decoded, resolutions, null)).toThrow(/Призрак Иван/);
    expect(listActive(db)).toHaveLength(0);
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(0);
  });

  it("throws if a rename targets an archived employee, and writes nothing", () => {
    const db = makeTestDb();
    const archived = createEmployee(db, { displayName: "Уволенный Олег" });
    archiveEmployee(db, archived.id, "2026-01-01");
    const decoded = decode([
      { name: "Уволенный Олег 2", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [{ csvName: "Уволенный Олег 2", action: "rename", employeeId: archived.id }];

    expect(() => applyRosterImport(db, decoded, resolutions, null)).toThrow(/Уволенный Олег 2/);
    expect(getEmployeeById(db, archived.id)!.displayName).toBe("Уволенный Олег"); // untouched
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-01")).toHaveLength(0);
  });

  it("throws if two csvNames claim the same employeeId, and writes nothing", () => {
    const db = makeTestDb();
    const shared = createEmployee(db, { displayName: "Общий Пётр" });
    const decoded = decode([
      { name: "Имя А", entries: [{ date: "2026-06-01", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
      { name: "Имя Б", entries: [{ date: "2026-06-02", endDate: null, category: "shift", templateId: 2, location: null, start: "09:00", end: "18:00", title: "День" }] },
    ]);
    const resolutions: PersonResolution[] = [
      { csvName: "Имя А", action: "rename", employeeId: shared.id },
      { csvName: "Имя Б", action: "rename", employeeId: shared.id },
    ];

    expect(() => applyRosterImport(db, decoded, resolutions, null)).toThrow(/Имя А.*Имя Б|Имя Б.*Имя А/);
    expect(getEmployeeById(db, shared.id)!.displayName).toBe("Общий Пётр"); // untouched
    expect(listShiftsInRange(db, "2026-06-01", "2026-06-02")).toHaveLength(0);
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

describe("an import and a hand-made order", () => {
  const CSV_PEOPLE = ["Анна Аз", "Борис Буки", "Вера Веди"];
  const decodedTrio = () => decode(CSV_PEOPLE.map((name) => ({ name, entries: [dayShift("2026-08-03")] })));
  const span = { from: "2026-08-01", to: "2026-08-31" };

  it("numbers the file's people in the file's own row order", () => {
    const db = makeTestDb();
    applyRosterImport(db, decodedTrio(), CSV_PEOPLE.map((csvName) => ({ csvName, action: "create" as const })), null, { span });
    expect(listActive(db).map((e) => e.displayName)).toEqual(CSV_PEOPLE);
    expect(listActive(db).map((e) => e.rosterOrder)).toEqual([0, 1, 2]);
  });

  it("puts somebody who is not in the file after it — never sharing a number with it", () => {
    const db = makeTestDb();
    applyRosterImport(db, decodedTrio(), CSV_PEOPLE.map((csvName) => ({ csvName, action: "create" as const })), null, { span });

    // An outsider parked in the middle of the list.
    const outsider = createEmployee(db, { displayName: "Не В Файле" }).id;
    reorderEmployee(db, outsider, 2);
    expect(listActive(db).map((e) => e.displayName)).toEqual(["Анна Аз", "Не В Файле", "Борис Буки", "Вера Веди"]);

    const ids = new Map(listActive(db).map((e) => [e.displayName, e.id]));
    applyRosterImport(
      db, decodedTrio(),
      CSV_PEOPLE.map((csvName) => ({ csvName, action: "rename" as const, employeeId: ids.get(csvName)! })),
      null, { span, overwrite: true },
    );

    // The file's order wins, the outsider follows it, and — the actual bug this
    // pins — every number is still unique and contiguous.
    expect(listActive(db).map((e) => e.displayName)).toEqual([...CSV_PEOPLE, "Не В Файле"]);
    const orders = listActive(db).map((e) => e.rosterOrder);
    expect(orders).toEqual([0, 1, 2, 3]);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("keeps several outsiders in their own relative order", () => {
    const db = makeTestDb();
    applyRosterImport(db, decodedTrio(), CSV_PEOPLE.map((csvName) => ({ csvName, action: "create" as const })), null, { span });
    const first = createEmployee(db, { displayName: "Гость Один" }).id;
    const second = createEmployee(db, { displayName: "Гость Два" }).id;
    reorderEmployee(db, second, 1);
    reorderEmployee(db, first, 1); // Один before Два

    const ids = new Map(listActive(db).map((e) => [e.displayName, e.id]));
    applyRosterImport(
      db, decodedTrio(),
      CSV_PEOPLE.map((csvName) => ({ csvName, action: "rename" as const, employeeId: ids.get(csvName)! })),
      null, { span, overwrite: true },
    );
    expect(listActive(db).map((e) => e.displayName)).toEqual([...CSV_PEOPLE, "Гость Один", "Гость Два"]);
  });
});
