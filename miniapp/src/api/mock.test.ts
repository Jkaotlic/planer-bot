import { afterEach, describe, expect, it } from "vitest";
import { buildTodayModel, buildWeekModel } from "../lib/team-schedule";
import { addDays, mondayOf, toISODate } from "../lib/week";
import {
  employeesMock,
  mockCreateEntry,
  mockDeleteEntry,
  mockGetTeamSchedule,
  mockGetTemplates,
  mockUpdateEntry,
  mockGetRosterCsv,
  mockPreviewRosterImport,
  mockApplyRosterImport,
  mockSetPreferredName,
  mockCreateCollection,
  mockGetCollections,
  mockGetCollectionPreview,
  mockSendCollection,
  mockGetBirthdayPreview,
  mockSaveBirthdayRound,
  mockGetNoticePrefs,
  mockSetNoticePref,
  MOCK_ME,
} from "./mock";

const createdEntryIds: number[] = [];

afterEach(async () => {
  await Promise.all(createdEntryIds.splice(0).map((id) => mockDeleteEntry(id)));
});

describe("team schedule development mock", () => {
  it("exposes every state required by the Today and Week visual QA", async () => {
    const monday = toISODate(mondayOf(new Date()));
    const sunday = toISODate(addDays(new Date(`${monday}T12:00:00`), 6));
    const [schedule, templates] = await Promise.all([
      mockGetTeamSchedule(monday, sunday),
      mockGetTemplates(),
    ]);

    const today = buildTodayModel(monday, schedule, templates);
    expect([...new Set(today.groups.map((group) => group.start))]).toEqual([
      "07:00",
      "08:00",
      "09:00",
      "11:00",
    ]);
    expect(today.noTimeGroups.length).toBeGreaterThan(0);

    const week = buildWeekModel(monday, schedule, templates);
    expect(week.rows.some((row) => row.cells.every((cell) => cell.entries.length === 0))).toBe(true);
    expect(week.rows.some((row) => row.employeeId === null)).toBe(true);

    const visibleCodes = new Set(
      week.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.entries.flatMap((entry) => entry.palette?.code ?? []),
        ),
      ),
    );
    // «?» is in the set on purpose: the mock carries one cell a roster import could
    // not read, so the grey square and its legend line get exercised in dev too.
    expect([...visibleCodes].sort()).toEqual(
      ["Д", "У", "В", "Н", "Т", "ВА", "П", "07", "О", "?"].sort(),
    );

    const detailCell = week.rows
      .flatMap((row) => row.cells)
      .find(
        (cell) =>
          cell.extraCount > 0
          && cell.entries.some((entry) => entry.shift.location)
          && cell.entries.some(
            (entry) =>
              entry.shift.endDate != null
              && entry.shift.endDate !== entry.shift.date,
          ),
      );
    expect(detailCell).toBeDefined();
  });

  it("preserves a supplied location when creating a schedule entry", async () => {
    const { entry: created } = await mockCreateEntry({
      date: "2099-01-10",
      start: "09:00",
      end: "18:00",
      category: "duty",
      title: "Выездное дежурство",
      location: "Поклонка",
      employeeId: 1,
    });
    createdEntryIds.push(created.id);

    expect(created.location).toBe("Поклонка");
  });

  it("preserves an updated location and clears it when the field is omitted", async () => {
    const { entry: created } = await mockCreateEntry({
      date: "2099-01-11",
      start: "09:00",
      end: "18:00",
      category: "duty",
      title: "Своя смена",
      location: "Старое место",
      employeeId: 1,
    });
    createdEntryIds.push(created.id);

    const { entry: updated } = await mockUpdateEntry(created.id, {
      date: created.date,
      start: created.start ?? undefined,
      end: created.end ?? undefined,
      category: created.category,
      title: created.title,
      location: "Новое место",
      employeeId: created.employeeId ?? undefined,
    });
    expect(updated.location).toBe("Новое место");

    const { entry: cleared } = await mockUpdateEntry(created.id, {
      date: created.date,
      start: created.start ?? undefined,
      end: created.end ?? undefined,
      category: created.category,
      title: created.title,
      employeeId: created.employeeId ?? undefined,
    });
    expect(cleared.location).toBeNull();
  });
});

describe("roster CSV development mock", () => {
  /** The month around today — what the export button in the Mini App asks for. */
  function thisMonth() {
    const iso = toISODate(new Date());
    const [year, month] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
  }

  it("exports a matrix its own preview can read back", async () => {
    const { from, to } = thisMonth();
    const csv = await mockGetRosterCsv(from, to);

    // Same shape as the real export: ';'-delimited, CRLF, дд.мм.гггг header.
    const lines = csv.split("\r\n");
    expect(lines[0]!.startsWith(";")).toBe(true);
    expect(lines[0]!.split(";")[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(lines.length).toBeGreaterThan(1);

    const preview = await mockPreviewRosterImport(csv);
    expect(preview.from).toBe(from);
    expect(preview.to).toBe(to);
    // Everyone in the export is an existing worker, so every row matches by name.
    expect(preview.people.every((p) => p.suggestedEmployeeId != null)).toBe(true);
  });

  it("marks weekend work as '?' and preserves it instead of calling it a bad code", async () => {
    const { from, to } = thisMonth();
    const csv = await mockGetRosterCsv(from, to);
    expect(csv).toContain(";?");

    const preview = await mockPreviewRosterImport(csv);
    expect(preview.unknowns).toEqual([]);
    expect(preview.preservedCount).toBeGreaterThan(0);
  });

  it("refuses a ragged row, naming it the way Excel numbers rows", async () => {
    await expect(mockPreviewRosterImport(";01.09.2026;02.09.2026\r\nИгорь Петров;k32"))
      .rejects.toThrow(/строка 2/);
  });

  // Живой пресет «Дежурство · Резерв» кодируется «rezerv», но MOCK_ROSTER_CODES
  // о нём не знал — DEV-мок бросал на файле, который реальный сервер принимает
  // предупреждением (unrecognisedCode), а не отказом.
  it("знает код «rezerv» — не отказывает на живом пресете «Дежурство · Резерв»", async () => {
    const preview = await mockPreviewRosterImport(";01.09.2026\r\nИгорь Петров;rezerv");
    expect(preview.unknowns).toEqual([]);
  });

  it("refuses an occupied period until overwrite is confirmed", async () => {
    const { from, to } = thisMonth();
    const csv = await mockGetRosterCsv(from, to);
    const preview = await mockPreviewRosterImport(csv);
    expect(preview.existingCount).toBeGreaterThan(0);

    const resolutions = preview.people.map((p) =>
      p.suggestedEmployeeId == null
        ? { csvName: p.csvName, action: "create" as const }
        : { csvName: p.csvName, action: "rename" as const, employeeId: p.suggestedEmployeeId },
    );
    await expect(mockApplyRosterImport(csv, resolutions, false)).rejects.toThrow(/уже есть/);

    const summary = await mockApplyRosterImport(csv, resolutions, true);
    expect(summary.entriesDeleted).toBeGreaterThan(0);
    // Weekend work is unencodable, so an overwrite must leave it where it was.
    expect(summary.cellsPreserved).toBeGreaterThan(0);
  });
});

describe("employeesMock.renameEmployee", () => {
  const EMPLOYEE_ID = 3; // «Марк Волков» — preferredName: null in the fixture.

  afterEach(async () => {
    // Put both fields back to the fixture's baseline for later tests.
    await employeesMock.renameEmployee(EMPLOYEE_ID, "Марк Волков");
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, null);
  });

  it("keeps the address in step with a rename when no preferredName overrides it", async () => {
    await employeesMock.renameEmployee(EMPLOYEE_ID, "Марк Волков-Новый");
    const employees = await employeesMock.getAdminEmployees();
    const employee = employees.find((e) => e.id === EMPLOYEE_ID)!;
    expect(employee.displayName).toBe("Марк Волков-Новый");
    expect(employee.address).toBe("Марк Волков-Новый");
  });

  it("leaves a chosen preferredName in place across a rename", async () => {
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, "Марик");
    await employeesMock.renameEmployee(EMPLOYEE_ID, "Марк Волков-Новый");
    const employees = await employeesMock.getAdminEmployees();
    const employee = employees.find((e) => e.id === EMPLOYEE_ID)!;
    expect(employee.displayName).toBe("Марк Волков-Новый");
    expect(employee.address).toBe("Марик");
  });
});

describe("mockSetPreferredName", () => {
  afterEach(() => {
    // MOCK_ME is a module-level singleton other tests/screens also read —
    // put it back to the fixture's baseline so nothing here leaks out.
    MOCK_ME.preferredName = null;
    MOCK_ME.address = "Аня";
  });

  it("saves a trimmed name and the address follows it", async () => {
    const result = await mockSetPreferredName("  Анюта  ");
    expect(result).toEqual({ preferredName: "Анюта", address: "Анюта" });
    expect(MOCK_ME.preferredName).toBe("Анюта");
    expect(MOCK_ME.address).toBe("Анюта");
  });

  it("clears on an empty or blank string, falling back to the Telegram name", async () => {
    for (const blank of ["", "   "]) {
      await mockSetPreferredName("Анюта");
      const result = await mockSetPreferredName(blank);
      expect(result).toEqual({ preferredName: null, address: "Аня" });
      expect(MOCK_ME.preferredName).toBeNull();
      expect(MOCK_ME.address).toBe("Аня");
    }
  });

  it("treats null the same as an empty string", async () => {
    await mockSetPreferredName("Анюта");
    const result = await mockSetPreferredName(null);
    expect(result).toEqual({ preferredName: null, address: "Аня" });
    expect(MOCK_ME.preferredName).toBeNull();
    expect(MOCK_ME.address).toBe("Аня");
  });
});

describe("employeesMock.setEmployeePreferredName", () => {
  const EMPLOYEE_ID = 2; // «Игорь Петров» — starts with preferredName: null in the fixture.

  async function employeeById(id: number) {
    const employees = await employeesMock.getAdminEmployees();
    const employee = employees.find((e) => e.id === id);
    if (!employee) throw new Error(`fixture employee ${id} not found`);
    return employee;
  }

  afterEach(async () => {
    // EMPLOYEES is a module-level singleton other tests in this file (and
    // other screens) also read — put this row back as the fixture found it.
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, null);
  });

  it("saves a trimmed name and the address follows it", async () => {
    const before = await employeeById(EMPLOYEE_ID);
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, "  Гоша  ");
    const after = await employeeById(EMPLOYEE_ID);
    expect(after.preferredName).toBe("Гоша");
    expect(after.address).toBe("Гоша");
    expect(after.displayName).toBe(before.displayName); // renaming is a separate mock
  });

  it("clears on an empty or blank string, falling back to displayName", async () => {
    const { displayName } = await employeeById(EMPLOYEE_ID);
    for (const blank of ["", "   "]) {
      await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, "Гоша");
      await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, blank);
      const employee = await employeeById(EMPLOYEE_ID);
      expect(employee.preferredName).toBeNull();
      expect(employee.address).toBe(displayName);
    }
  });

  it("treats null the same as an empty string", async () => {
    const { displayName } = await employeeById(EMPLOYEE_ID);
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, "Гоша");
    await employeesMock.setEmployeePreferredName(EMPLOYEE_ID, null);
    const employee = await employeeById(EMPLOYEE_ID);
    expect(employee.preferredName).toBeNull();
    expect(employee.address).toBe(displayName);
  });
});

describe("мок сборов", () => {
  it("отдаёт заведённый сбор в списке и в предпросмотре", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", amountPerPerson: 1000 });
    const rows = await mockGetCollections();
    expect(rows.map((r) => r.title)).toContain("Кофемашина");

    const preview = await mockGetCollectionPreview(created.id);
    expect(preview.message).toContain("Скидываемся по 1 000 ₽");
    expect(preview.blocker).toContain("Нет ссылки");
  });

  it("после рассылки кастомный сбор можно дожать, а ДР нельзя", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", collectUrl: "https://example.test/c/1" });
    await mockSendCollection(created.id);
    expect((await mockGetCollectionPreview(created.id)).blocker).toBeNull();
    expect((await mockGetCollectionPreview(created.id)).sendCount).toBe(1);

    // Вторая половина названия теста: раунд ДР после рассылки — наоборот,
    // дожать нельзя. id 2 — «Игорь Петров», у него есть дата рождения в
    // фикстуре, и это не MOCK_ME (id 1), так что сюрприз-правило его не тронет.
    const BIRTHDAY_EMPLOYEE_ID = 2;
    const round = await mockSaveBirthdayRound(BIRTHDAY_EMPLOYEE_ID, { collectUrl: "https://example.test/dr" });
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBeNull();

    await mockSendCollection(round.id);
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBe("Уже разослано — повторная отправка отключена.");
  });

  it("сюрприз-правило: свой сбор не виден в списке и не открывается по id — чужой виден", async () => {
    const hidden = await mockCreateCollection({ title: "Секретный сбор", employeeId: MOCK_ME.id });
    const visible = await mockCreateCollection({ title: "Открытый сбор" });

    const rows = await mockGetCollections();
    expect(rows.some((r) => r.collection.id === hidden.id)).toBe(false);
    expect(rows.some((r) => r.collection.id === visible.id)).toBe(true);

    await expect(mockGetCollectionPreview(hidden.id)).rejects.toThrow("not_found");
  });
});

describe("уведомления администратора: mockGetNoticePrefs / mockSetNoticePref", () => {
  afterEach(async () => {
    // Мут-состояние живёт в модульном Set (как mockSwapsLocked чуть выше в
    // mock.ts) — вернуть все виды во включённое состояние, иначе тест, что
    // мутировал вид, протечёт в следующий.
    const { kinds } = await mockGetNoticePrefs();
    await Promise.all(kinds.filter((k) => !k.enabled).map((k) => mockSetNoticePref(k.kind, true)));
  });

  it("по умолчанию отдаёт все шесть видов включёнными", async () => {
    const { kinds } = await mockGetNoticePrefs();
    expect(kinds).toHaveLength(6);
    expect(kinds.every((k) => k.enabled)).toBe(true);
  });

  it("выключение вида переживает перечитывание и не задевает остальные", async () => {
    await mockSetNoticePref("swaps", false);

    const afterMute = await mockGetNoticePrefs();
    expect(afterMute.kinds.find((k) => k.kind === "swaps")?.enabled).toBe(false);
    expect(afterMute.kinds.filter((k) => k.kind !== "swaps").every((k) => k.enabled)).toBe(true);

    await mockSetNoticePref("swaps", true);
    const afterUnmute = await mockGetNoticePrefs();
    expect(afterUnmute.kinds.find((k) => k.kind === "swaps")?.enabled).toBe(true);
  });
});
