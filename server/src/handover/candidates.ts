import { shiftsOverlap, canSwap } from "@planer/shared";
import type { Db } from "../db/client";
import { type Employee, type Shift } from "../db/schema";
import { listActive } from "../repo/employees";
import { listShiftsOverlapping } from "../repo/shifts";
import { getTemplateRoles } from "../repo/template-roles";

/**
 * Does this entry of somebody else's stand in the way of taking `shift`?
 *
 * `shiftsOverlap` alone is not enough here, and the gap is not academic: an
 * absence carries no times at all. Asking it whether «отпуск» overlaps a
 * 09:00–18:00 shift would compare against a missing start and answer «нет» —
 * that is, offer the shift to somebody on holiday. Anything without times
 * covers its whole day, and a multi-day absence covers each of them.
 */
function standsInTheWay(mine: Shift, shift: Shift): boolean {
  const daysOverlap =
    mine.date <= (shift.endDate ?? shift.date) && shift.date <= (mine.endDate ?? mine.date);
  if (!daysOverlap) return false;
  const bothTimed = mine.start != null && mine.end != null && shift.start != null && shift.end != null;
  if (!bothTimed) return true;
  return shiftsOverlap(
    { date: mine.date, start: mine.start!, end: mine.end! },
    { date: shift.date, start: shift.start!, end: shift.end! },
  );
}

/**
 * Who can be offered this shift, best first.
 *
 * «Free» is measured with the same `shiftsOverlap` the swap validator uses, so
 * the two surfaces cannot drift on what «занят» means — with one addition for
 * entries that carry no times (see `standsInTheWay`).
 *
 * The duty pool sorts to the top and shuts nobody out. That is the owner's
 * decision from 2026-08-10, taken with the risk named out loud: a duty can be
 * taken by anyone, and the pool is the rule for automatic distribution only.
 */
export function handoverCandidates(
  db: Db,
  shift: Shift,
  opts: { excludeIds?: readonly number[] } = {},
): Employee[] {
  const excluded = new Set(opts.excludeIds ?? []);
  const around = listShiftsOverlapping(db, shift.date, shift.endDate ?? shift.date);
  const pool = new Set(shift.templateId != null ? getTemplateRoles(db, shift.templateId).pool : []);

  return listActive(db)
    .filter((employee) => employee.id !== shift.employeeId && !excluded.has(employee.id) && canSwap(employee))
    .filter(
      (employee) =>
        !around.some((mine) => mine.employeeId === employee.id && mine.id !== shift.id && standsInTheWay(mine, shift)),
    )
    .sort((a, b) => Number(pool.has(b.id)) - Number(pool.has(a.id)) || a.id - b.id);
}
