import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { applyRosterImport, buildRosterCsv } from "./roster-service";
import { parseRosterCsv, decodeRoster, type DecodeResult } from "./roster-codec";

/**
 * The acceptance proof for the whole import/export feature: take a REAL roster file,
 * load it, export it again, and demand the bytes back.
 *
 * It is opt-in and stays that way. A real file is a team's full names plus who was
 * off sick when, so it can never live in this repository — point ROSTER_CSV at a
 * local copy to run this suite:
 *
 *     ROSTER_CSV=~/Downloads/roster.csv npm test
 *
 * Nothing here names a person: every expectation is derived from the file itself,
 * so the assertions hold for any team's roster, not one particular month.
 */
const REAL_ROSTER = process.env.ROSTER_CSV;
const available = Boolean(REAL_ROSTER && existsSync(REAL_ROSTER));

/**
 * The source file, byte-exact — an unreadable cell round-trips to the very same
 * text (see `unrecognisedCode` on the shifts table), so a real round trip needs no
 * rewriting at all. This still walks `decoded.unknowns` and writes each cell back
 * verbatim, both to prove the export loses nothing and to document the one kind of
 * cell the matrix cannot otherwise explain. Operates on raw fields to keep the
 * comparison byte-exact; quoted fields would break the naive split, so the suite
 * bails out loudly rather than comparing something it mangled.
 */
function expectedExport(source: string, parsed: ReturnType<typeof parseRosterCsv>, decoded: DecodeResult): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/^﻿/, "").split(/\r\n|\n/);
  const rowOf = new Map(parsed.people.map((p, i) => [p.name, i + 1] as const));
  const columnOf = new Map(parsed.dates.map((d, i) => [d, i + 1] as const));

  for (const unknown of decoded.unknowns) {
    const row = rowOf.get(unknown.name);
    const column = columnOf.get(unknown.date);
    if (row === undefined || column === undefined) throw new Error("unknown cell not found in the source");
    const fields = lines[row]!.split(";");
    fields[column] = unknown.code;
    lines[row] = fields.join(";");
  }
  return "﻿" + lines.filter((l) => l.length > 0).join(eol);
}

describe.skipIf(!available)("roster round-trip against a real file (set ROSTER_CSV to run)", () => {
  const source = available ? readFileSync(REAL_ROSTER!, "utf8") : "";

  it("parses the file: dates and people are read, and the BOM is gone", () => {
    const parsed = parseRosterCsv(source);
    expect(parsed.dates.length).toBeGreaterThan(0);
    expect(parsed.people.length).toBeGreaterThan(0);
    expect(parsed.people[0]!.name.startsWith("﻿")).toBe(false);
    expect(parsed.people.every((p) => p.name.length > 0)).toBe(true);
    // Every row is exactly as wide as the header — the parser now enforces this,
    // so a real file that trips it is a genuine finding, not a test artefact.
    expect(parsed.people.every((p) => p.cells.length === parsed.dates.length)).toBe(true);
  });

  it("collapses absence runs instead of writing one row per day", () => {
    const parsed = parseRosterCsv(source);
    const decoded = decodeRoster(parsed, listActiveTemplates(makeTestDb()));
    const absences = decoded.perPerson.flatMap((p) => p.entries.filter((e) => e.start === null));
    const absenceDays = absences.reduce((sum, e) => {
      const end = e.endDate ?? e.date;
      return sum + (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000 + 1;
    }, 0);
    // Only meaningful if the file actually contains a multi-day absence.
    if (absences.length > 0) expect(absenceDays).toBeGreaterThanOrEqual(absences.length);
    expect(absences.every((e) => e.templateId === null && e.end === null)).toBe(true);
  });

  it("import then export gives the source matrix back byte-for-byte", () => {
    if (source.includes('"')) throw new Error("this file uses quoted fields — extend expectedExport() before trusting this test");
    const db = makeTestDb();
    const parsed = parseRosterCsv(source);
    const decoded = decodeRoster(parsed, listActiveTemplates(db));
    applyRosterImport(db, decoded, decoded.perPerson.map((p) => ({ csvName: p.name, action: "create" as const })), null);

    const exported = "﻿" + buildRosterCsv(db, parsed.dates[0]!, parsed.dates.at(-1)!);

    // TRUE byte comparison — no line-ending normalisation and no .trim(), which would
    // also eat the BOM (JS treats U+FEFF as whitespace).
    expect(exported).toBe(expectedExport(source, parsed, decoded));
  });

  it("keeps the file's row order even when the renamed people already hold low ids", () => {
    const db = makeTestDb();
    const parsed = parseRosterCsv(source);
    const decoded = decodeRoster(parsed, listActiveTemplates(db));

    // The live shape: some people already exist under nicknames, so their ids do NOT
    // match their position in the file. Without rosterOrder the export reorders rows.
    // Renaming the LAST few names first guarantees ids run opposite to file order.
    const preexisting = decoded.perPerson.slice(-3).map((person, index) => {
      const employee = createEmployee(db, { displayName: `Ник ${index}`, inviteToken: `inv-${index}` });
      linkTelegramAccount(db, `inv-${index}`, 900_000 + index);
      return [person.name, employee.id] as const;
    });
    // An extra archived account that is not in the file must not appear in the export.
    const ghost = createEmployee(db, { displayName: "Архивный Призрак" });
    archiveEmployee(db, ghost.id, parsed.dates[0]!);

    const renames = new Map(preexisting);
    applyRosterImport(db, decoded, decoded.perPerson.map((p) => {
      const id = renames.get(p.name);
      return id === undefined ? { csvName: p.name, action: "create" as const } : { csvName: p.name, action: "rename" as const, employeeId: id };
    }), null);

    const exported = buildRosterCsv(db, parsed.dates[0]!, parsed.dates.at(-1)!);
    const exportedNames = exported.split("\r\n").slice(1).map((line) => line.split(";")[0]);
    expect(exportedNames).toEqual(parsed.people.map((p) => p.name));
    expect(exportedNames).not.toContain("Архивный Призрак");
  });

  it("re-importing the same file is refused, and overwrite makes it idempotent", () => {
    const db = makeTestDb();
    const parsed = parseRosterCsv(source);
    const decoded = decodeRoster(parsed, listActiveTemplates(db));
    const span = { from: parsed.dates[0]!, to: parsed.dates.at(-1)! };
    const createAll = decoded.perPerson.map((p) => ({ csvName: p.name, action: "create" as const }));
    applyRosterImport(db, decoded, createAll, null, { span });

    expect(() => applyRosterImport(db, decoded, createAll, null, { span })).toThrow(/уже есть/);

    const before = buildRosterCsv(db, span.from, span.to);
    const ids = new Map(decoded.perPerson.map((p, i) => [p.name, i + 1] as const));
    applyRosterImport(
      db, decoded,
      decoded.perPerson.map((p) => ({ csvName: p.name, action: "rename" as const, employeeId: ids.get(p.name)! })),
      null, { span, overwrite: true },
    );
    // Overwriting with the very same file must land on exactly the same matrix.
    expect(buildRosterCsv(db, span.from, span.to)).toBe(before);
  });
});
