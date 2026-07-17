import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseRosterCsv, decodeRoster } from "./roster-codec";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";

const FILE = "/Users/user/Downloads/Дежурства 2026.csv";

describe("parseRosterCsv", () => {
  it("reads the real June file: 30 dates, 26 people, BOM stripped", () => {
    const parsed = parseRosterCsv(readFileSync(FILE, "utf8"));
    expect(parsed.dates).toHaveLength(30);
    expect(parsed.dates[0]).toBe("2026-06-01");
    expect(parsed.dates[29]).toBe("2026-06-30");
    expect(parsed.people).toHaveLength(26);
    // BOM must be gone — the first name is clean, not "﻿Юдин…".
    expect(parsed.people[0].name).toBe("Юдин Максим");
    expect(parsed.people[1].name).toBe("Панов Евгений");
    expect(parsed.people[0].cells[0]).toEqual({ date: "2026-06-01", code: "otp" });
    expect(parsed.people[1].cells[0]).toEqual({ date: "2026-06-01", code: "dezh" });
  });

  it("handles CRLF, LF and a trailing newline the same", () => {
    const text = "﻿;01.06.2026;02.06.2026\r\nИван;k32;holiday\r\n";
    const parsed = parseRosterCsv(text);
    expect(parsed.dates).toEqual(["2026-06-01", "2026-06-02"]);
    expect(parsed.people).toEqual([{ name: "Иван", cells: [
      { date: "2026-06-01", code: "k32" }, { date: "2026-06-02", code: "holiday" },
    ] }]);
  });

  it("rejects a malformed header date", () => {
    expect(() => parseRosterCsv(";2026-06-01\nИван;k32")).toThrow(/дата/i);
  });
});

describe("decodeRoster (against the real June file + real presets)", () => {
  const templates = listActiveTemplates(makeTestDb()); // migration 0006 seeds all 8
  const decoded = decodeRoster(parseRosterCsv(readFileSync(FILE, "utf8")), templates);
  const person = (name: string) => decoded.perPerson.find((p) => p.name === name)!;

  it("collapses vacation and business-trip runs into 14 ranged rows total", () => {
    const absences = decoded.perPerson.flatMap((p) => p.entries.filter((e) => e.start === null));
    expect(absences).toHaveLength(14); // spec §5: 99 cells -> 14 rows

    const yudin = person("Юдин Максим").entries.find((e) => e.category === "vacation")!;
    expect(yudin).toMatchObject({ date: "2026-06-01", endDate: "2026-06-14", start: null, end: null, templateId: null });

    const nosov = person("Носов Максим").entries.find((e) => e.category === "business_trip")!;
    expect(nosov).toMatchObject({ date: "2026-06-01", endDate: "2026-06-07" });
  });

  it("shortens День on Friday but starts Вечер later without shortening", () => {
    // 2026-06-05 is a Friday (weekend cells 06/07.06 are Sat/Sun).
    const efimovFri = person("Дьяков Алексей").entries.find((e) => e.date === "2026-06-05")!;
    expect(efimovFri).toMatchObject({ category: "shift", title: "День", start: "09:00", end: "16:45" });
    const korenevFri = person("Лапин Виктор").entries.find((e) => e.date === "2026-06-05")!;
    expect(korenevFri).toMatchObject({ category: "shift", title: "Вечер", start: "12:00", end: "20:00" });
  });

  it("maps duty codes to the right presets with their location", () => {
    const pokl = person("Мишин Илья").entries.find((e) => e.date === "2026-06-01")!;
    expect(pokl).toMatchObject({ category: "duty", title: "Дежурство · Поклонка", location: "Поклонка", start: "09:00", end: "18:00" });
    const phone = person("Панов Евгений").entries.find((e) => e.date === "2026-06-01")!;
    expect(phone).toMatchObject({ category: "duty", title: "Дежурство · Телефон", start: "09:00", end: "18:00" });
  });

  it("reports the single undecodable cell and records nothing for it", () => {
    expect(decoded.unknowns).toEqual([{ name: "Хохлов Дмитрий", date: "2026-06-03", code: "Нет" }]);
    expect(person("Хохлов Дмитрий").entries.some((e) => e.date === "2026-06-03")).toBe(false);
  });

  it("proposes exactly the 9 non-working days, incl. the 12 June holiday", () => {
    expect(decoded.proposedHolidays).toHaveLength(9);
    expect(decoded.proposedHolidays).toContain("2026-06-12");
    expect(decoded.proposedHolidays).toContain("2026-06-06"); // a Saturday
  });
});
