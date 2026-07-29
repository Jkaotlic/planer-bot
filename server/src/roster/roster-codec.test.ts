import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRosterCsv, decodeRoster, CODE_TO_PRESET_NAME, PRESET_NAME_TO_CODE } from "./roster-codec";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";
import type { DecodeResult } from "./roster-codec";

// Fake names, engineered byte-for-byte like the real export: UTF-8 BOM, CRLF, ';'
// delimiter, no trailing newline. See task-10-brief.md Fix 4 for what it must cover.
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/roster-sample.csv"), "utf8");

describe("parseRosterCsv", () => {
  it("handles CRLF, bare LF, and a trailing newline the same", () => {
    const expected = { dates: ["2026-06-01", "2026-06-02"], people: [{ name: "Иван", cells: [
      { date: "2026-06-01", code: "k32" }, { date: "2026-06-02", code: "holiday" },
    ] }] };
    const crlf = "﻿;01.06.2026;02.06.2026\r\nИван;k32;holiday";
    const lf = "﻿;01.06.2026;02.06.2026\nИван;k32;holiday";
    const trailingNewline = "﻿;01.06.2026;02.06.2026\r\nИван;k32;holiday\r\n";
    expect(parseRosterCsv(crlf)).toEqual(expected);
    expect(parseRosterCsv(lf)).toEqual(expected);
    expect(parseRosterCsv(trailingNewline)).toEqual(expected);
  });

  it("rejects a malformed header date", () => {
    expect(() => parseRosterCsv(";2026-06-01\nИван;k32")).toThrow(/дата/i);
  });

  it("rejects a calendar date that matches the format but does not exist", () => {
    expect(() => parseRosterCsv(";31.02.2026\nИван;k32")).toThrow(/дата/i);
  });

  it("round-trips a quoted employee name containing the delimiter and quotes", () => {
    const parsed = parseRosterCsv(';01.08.2026\n"Иван; ""Старший""";k32');
    expect(parsed.people[0]?.name).toBe('Иван; "Старший"');
    expect(parsed.people[0]?.cells).toEqual([{ date: "2026-08-01", code: "k32" }]);
  });

  it("rejects a row with fewer cells than the header has dates", () => {
    // Header carries 3 dates; Пётр's row stops after one. Padding it out silently
    // would import the two missing days as "не работает" — invented data.
    const text = ";01.08.2026;02.08.2026;03.08.2026\nИван;k32;k32;k32\nПётр;k32";
    expect(() => parseRosterCsv(text)).toThrow(/Пётр.*3.*1|Пётр/);
  });

  it("rejects a row with more cells than the header has dates", () => {
    const text = ";01.08.2026;02.08.2026\nИван;k32;k32;k32";
    expect(() => parseRosterCsv(text)).toThrow(/Иван/);
  });

  it("names the offending row so the admin can find it in Excel", () => {
    const text = ";01.08.2026;02.08.2026\nИван;k32;k32\nПётр;k32";
    expect(() => parseRosterCsv(text)).toThrow(/строка 3/);
  });

  it("parses the synthetic fixture: 8 dates, 6 people, BOM stripped", () => {
    const parsed = parseRosterCsv(FIXTURE);
    expect(parsed.dates).toEqual([
      "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04",
      "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08",
    ]);
    expect(parsed.people).toHaveLength(6);
    // BOM must be gone — the first name is clean, not "﻿Смирнов…".
    expect(parsed.people[0].name).toBe("Смирнов Алексей");
    expect(parsed.people[0].cells[0]).toEqual({ date: "2026-07-01", code: "k32" });
  });
});

describe("decodeRoster (against the synthetic fixture)", () => {
  const templates = listActiveTemplates(makeTestDb()); // migration 0006 seeds all 8 presets
  const decoded = decodeRoster(parseRosterCsv(FIXTURE), templates);
  const person = (name: string) => decoded.perPerson.find((p) => p.name === name)!;

  it("maps all 8 work codes to their presets", () => {
    // Non-Friday cells (2026-07-01 is a Wednesday) so times are the plain (non-shortened) ones.
    expect(person("Смирнов Алексей").entries.find((e) => e.date === "2026-07-01")).toMatchObject(
      { category: "shift", title: "День", start: "09:00", end: "18:00" });
    expect(person("Кузнецова Мария").entries.find((e) => e.date === "2026-07-01")).toMatchObject(
      { category: "shift", title: "Вечер", start: "11:00", end: "20:00" });
    expect(person("Соколов Дмитрий").entries.find((e) => e.date === "2026-07-01")).toMatchObject(
      { category: "duty", title: "Дежурство с 07:00", start: "07:00", end: "16:00" });
    expect(person("Соколов Дмитрий").entries.find((e) => e.date === "2026-07-02")).toMatchObject(
      { category: "shift", title: "Утро", start: "08:00", end: "17:00" });
    expect(person("Соколов Дмитрий").entries.find((e) => e.date === "2026-07-03")).toMatchObject(
      { category: "shift", title: "Ночь" });
    expect(person("Морозова Ольга").entries.find((e) => e.date === "2026-07-01")).toMatchObject(
      { category: "duty", title: "Дежурство · Телефон", location: null, start: "09:00", end: "18:00" });
    expect(person("Морозова Ольга").entries.find((e) => e.date === "2026-07-02")).toMatchObject(
      { category: "duty", title: "Дежурство · Поклонка", location: "Поклонка", start: "09:00", end: "18:00" });
    expect(person("Морозова Ольга").entries.find((e) => e.date === "2026-07-03")).toMatchObject(
      { category: "duty", title: "Дежурство · Вавилова 19", location: "Вавилова 19" });
  });

  it("shortens День on Friday but starts Вечер later without shortening", () => {
    // 2026-07-03 is a Friday (07-04/07-05 are Sat/Sun).
    const smirnovFri = person("Смирнов Алексей").entries.find((e) => e.date === "2026-07-03")!;
    expect(smirnovFri).toMatchObject({ category: "shift", title: "День", start: "09:00", end: "16:45" });
    const kuznetsovaFri = person("Кузнецова Мария").entries.find((e) => e.date === "2026-07-03")!;
    expect(kuznetsovaFri).toMatchObject({ category: "shift", title: "Вечер", start: "12:00", end: "20:00" });
  });

  it("splits two different adjacent absence codes into two runs, not one merged run", () => {
    const entries = person("Волкова Анна").entries;
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.category === "vacation")).toMatchObject(
      { date: "2026-07-01", endDate: "2026-07-02", start: null, end: null, templateId: null });
    expect(entries.find((e) => e.category === "business_trip")).toMatchObject(
      { date: "2026-07-03", endDate: "2026-07-04", start: null, end: null, templateId: null });
  });

  it("reports an unreadable cell AND keeps it, marked, instead of dropping the day", () => {
    expect(decoded.unknowns).toEqual([{ name: "Белова Ирина", date: "2026-07-06", code: "xyz" }]);
    // Dropping it would quietly turn a working day into a day off — the more
    // expensive of the two mistakes. It is kept with the original text on it.
    const cell = person("Белова Ирина").entries.find((e) => e.date === "2026-07-06")!;
    expect(cell.unrecognisedCode).toBe("xyz");
    expect(cell.templateId).toBeNull();
    expect({ start: cell.start, end: cell.end }).toEqual({ start: null, end: null });
  });

  it("proposes the columns nobody works on as holidays", () => {
    // 07-04/07-05 (weekend) have zero work codes — every cell is 'holiday' or an
    // absence code, and absences don't count as work (§5).
    expect(decoded.proposedHolidays).toContain("2026-07-04");
    expect(decoded.proposedHolidays).toContain("2026-07-05");
  });
});

describe("CODE_TO_PRESET_NAME stays resolvable (Stage 3 preset-editor guard)", () => {
  it("every preset name the codec knows about exists as an active template", () => {
    const templates = listActiveTemplates(makeTestDb());
    const activeNames = new Set(templates.map((t) => t.name));
    for (const name of Object.values(CODE_TO_PRESET_NAME)) {
      expect(activeNames.has(name), `CODE_TO_PRESET_NAME names "${name}", which is not an active template`).toBe(true);
    }
    for (const name of Object.keys(PRESET_NAME_TO_CODE)) {
      expect(activeNames.has(name), `PRESET_NAME_TO_CODE names "${name}", which is not an active template`).toBe(true);
    }
  });
});

describe("UNENCODABLE_CODE ('?') round-trip closure", () => {
  // '?' is what the export writes for a covering entry the roster vocabulary can't
  // express (weekend work, a one-off custom time). Re-importing that file must not
  // be blocked by it: '?' means "there is something here — leave it alone".
  it("a '?' cell is preserved, not reported as an unknown code", () => {
    const text = "﻿;01.06.2026\r\nИван;?";
    const decoded = decodeRoster(parseRosterCsv(text), listActiveTemplates(makeTestDb()));
    expect(decoded.unknowns).toEqual([]);
    expect(decoded.preserved).toEqual([{ name: "Иван", date: "2026-06-01" }]);
    expect(decoded.perPerson).toEqual([{ name: "Иван", entries: [] }]);
  });

  it("a '?' day counts as worked, so it is never proposed as a holiday", () => {
    const text = "﻿;01.06.2026;02.06.2026\r\nИван;?;holiday";
    const decoded = decodeRoster(parseRosterCsv(text), listActiveTemplates(makeTestDb()));
    expect(decoded.proposedHolidays).toEqual(["2026-06-02"]);
  });
});

describe("prototype-chain-safe code lookups", () => {
  it("a cell literally reading 'constructor' is reported as unknown, not classified as an absence", () => {
    const text = "﻿;01.06.2026\r\nИван;constructor";
    const decoded = decodeRoster(parseRosterCsv(text), listActiveTemplates(makeTestDb()));
    expect(decoded.unknowns).toEqual([{ name: "Иван", date: "2026-06-01", code: "constructor" }]);
    expect(decoded.perPerson[0]!.entries[0]!.unrecognisedCode).toBe("constructor");
  });
});

describe("rezerv — резервный дежурный", () => {
  const templates = () => listActiveTemplates(makeTestDb());

  it("decodes to the Резерв preset instead of being an unknown code", () => {
    const parsed = parseRosterCsv("﻿;08.08.2026\r\nИван;rezerv");
    const decoded = decodeRoster(parsed, templates());

    expect(decoded.unknowns).toEqual([]);
    const entry = decoded.perPerson[0]!.entries[0]!;
    expect(entry.title).toBe("Дежурство · Резерв");
    expect(entry.category).toBe("duty");
    expect(entry.start).toBe("09:00");
  });

  it("counts as somebody covering the day, so a reserve-only weekend is not a holiday", () => {
    // In the August file every rezerv falls on a Saturday or Sunday. If it did not
    // count as work, importing would propose those days as company holidays and
    // then write «не работает» over them.
    const parsed = parseRosterCsv("﻿;08.08.2026;09.08.2026\r\nИван;rezerv;holiday");
    const decoded = decodeRoster(parsed, templates());

    expect(decoded.proposedHolidays).toEqual(["2026-08-09"]);
  });

  it("survives the export/import round trip", () => {
    const parsed = parseRosterCsv("﻿;08.08.2026\r\nИван;rezerv");
    expect(PRESET_NAME_TO_CODE["Дежурство · Резерв"]).toBe("rezerv");
    expect(CODE_TO_PRESET_NAME["rezerv"]).toBe("Дежурство · Резерв");
    expect(parsed.people[0]!.cells[0]!.code).toBe("rezerv");
  });

  it("does not collapse a run of reserve days into one range", () => {
    // Only absences are ranges; a duty is one entry per day, or two people on the
    // same weekend would be indistinguishable from one person on a two-day range.
    const parsed = parseRosterCsv("﻿;08.08.2026;09.08.2026\r\nИван;rezerv;rezerv");
    const decoded = decodeRoster(parsed, templates());

    expect(decoded.perPerson[0]!.entries).toHaveLength(2);
    expect(decoded.perPerson[0]!.entries.every((e) => e.endDate === null)).toBe(true);
  });
});
