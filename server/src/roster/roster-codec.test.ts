import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseRosterCsv } from "./roster-codec";

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
