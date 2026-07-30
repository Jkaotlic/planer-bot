import { countsForBalance } from "@planer/shared";
import type { Db } from "../db/client";
import { listActive } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsInRange } from "../repo/shifts";

/**
 * «Кто сколько отдежурил» — a table of people × kinds over a period.
 *
 * Counted by KIND, not by hours, for the same reason fairness is: the question is
 * never "who worked more" but "who did more nights", and a phone duty and an
 * evening shift are not interchangeable however long each ran.
 */

export interface ShiftCountsRow {
  employeeId: number;
  displayName: string;
  /** kind -> how many entries of it in the period. Absent kinds are simply zero. */
  byKind: Record<string, number>;
  total: number;
}

export interface ShiftCountsReport {
  from: string;
  to: string;
  /** Column order: the presets in their own sort order, then anything one-off. */
  kinds: string[];
  rows: ShiftCountsRow[];
}

/** A one-off entry with no preset behind it — grouped under a single column. */
const CUSTOM_KIND = "Своё время";

/**
 * A roster cell the import could not read (see `unrecognisedCode` on the shifts
 * table). It is a shift of unknown kind — real work, so it must count — but it is
 * not the same thing as somebody hand-timing a shift, so it gets its own column
 * rather than hiding inside «Своё время». The «?» matches how the mini app already
 * marks such a cell.
 */
const UNRECOGNISED_KIND = "Не распознано (?)";

export function buildShiftCountsReport(db: Db, from: string, to: string): ShiftCountsReport {
  const templates = listActiveTemplates(db);
  const nameById = new Map(templates.map((template) => [template.id, template.name] as const));
  const employees = listActive(db);

  const rows = new Map<number, ShiftCountsRow>(
    employees.map((employee) => [
      employee.id,
      { employeeId: employee.id, displayName: employee.displayName, byKind: {}, total: 0 },
    ]),
  );
  const seenKinds = new Set<string>();

  for (const shift of listShiftsInRange(db, from, to)) {
    // Absences are not work — an отпуск is not "a kind he did fewer of".
    if (!countsForBalance(shift.category) || shift.employeeId == null) continue;
    const row = rows.get(shift.employeeId);
    if (!row) continue; // archived: their history stays, but they're off the report

    const kind = shift.unrecognisedCode != null
      ? UNRECOGNISED_KIND
      : (shift.templateId != null ? nameById.get(shift.templateId) : undefined) ?? shift.title ?? CUSTOM_KIND;
    row.byKind[kind] = (row.byKind[kind] ?? 0) + 1;
    row.total += 1;
    seenKinds.add(kind);
  }

  // Presets first, in the order the admin sees them everywhere else; then the
  // leftovers (a renamed preset, a one-off) alphabetically, so the table is stable.
  const preset = templates.map((template) => template.name).filter((name) => seenKinds.has(name));
  const rest = [...seenKinds].filter((kind) => !preset.includes(kind)).sort((a, b) => a.localeCompare(b, "ru"));

  return { from, to, kinds: [...preset, ...rest], rows: [...rows.values()] };
}

function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The same table as a ';'-delimited CSV, for Excel — the download route adds the BOM. */
export function shiftCountsCsv(report: ShiftCountsReport): string {
  const header = ["Работник", ...report.kinds, "Всего"].map(csvField).join(";");
  const lines = report.rows.map((row) =>
    [csvField(row.displayName), ...report.kinds.map((kind) => String(row.byKind[kind] ?? 0)), String(row.total)].join(";"),
  );
  return [header, ...lines].join("\r\n");
}
