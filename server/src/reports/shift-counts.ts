import { tallyShiftCounts, type ShiftCountsReport } from "@planer/shared";
import type { Db } from "../db/client";
import { listActive } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsInRange } from "../repo/shifts";

export type { ShiftCountsReport, ShiftCountsRow } from "@planer/shared";
// CSV живёт в shared рядом с подсчётом: его же отдаёт мок консоли.
export { shiftCountsCsv } from "@planer/shared";

/**
 * «Кто сколько отдежурил». Сам подсчёт — в shared (`tallyShiftCounts`): его же
 * зовут моки обеих морд, и три копии правила «что куда относится» разъехались бы.
 */
export function buildShiftCountsReport(db: Db, from: string, to: string): ShiftCountsReport {
  return tallyShiftCounts({
    from,
    to,
    entries: listShiftsInRange(db, from, to),
    templates: listActiveTemplates(db).map((t) => ({ id: t.id, name: t.name, category: t.category, accent: t.accent ?? null })),
    employees: listActive(db),
  });
}
