import { tallyShiftCounts, SHIFT_COUNTS_GROUPS, type ShiftCountsGroup, type ShiftCountsReport } from "@planer/shared";
import type { Db } from "../db/client";
import { listActive } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { listShiftsInRange } from "../repo/shifts";

export type { ShiftCountsReport, ShiftCountsRow } from "@planer/shared";

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

function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const GROUP_TOTAL_TITLES: Record<ShiftCountsGroup, string> = {
  shift: "Смен всего",
  duty: "Дежурств всего",
  other: "Прочего всего",
};

/**
 * Та же таблица для Excel, через ';' — BOM добавляет маршрут. Итог каждой группы
 * стоит сразу за её видами, как в консоли; общего «Всего» нет — он складывал
 * несравнимое.
 */
export function shiftCountsCsv(report: ShiftCountsReport): string {
  const columns: { title: string; value: (row: ShiftCountsReport["rows"][number]) => number }[] = [];
  for (const group of SHIFT_COUNTS_GROUPS) {
    const kinds = report.kinds.filter((k) => k.group === group);
    if (kinds.length === 0) continue;
    for (const kind of kinds) columns.push({ title: kind.name, value: (row) => row.byKind[kind.name] ?? 0 });
    columns.push({ title: GROUP_TOTAL_TITLES[group], value: (row) => row.byGroup[group] });
  }
  const header = ["Работник", ...columns.map((c) => c.title)].map(csvField).join(";");
  const lines = report.rows.map((row) => [csvField(row.displayName), ...columns.map((c) => String(c.value(row)))].join(";"));
  return [header, ...lines].join("\r\n");
}
