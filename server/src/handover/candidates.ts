import { canSwap } from "@planer/shared";
import type { Db } from "../db/client";
import { type Employee, type Shift } from "../db/schema";
import { listActive } from "../repo/employees";
import { getTemplateRoles } from "../repo/template-roles";
import { busyWith } from "../schedule/busy";

/**
 * Who can be offered this shift, best first.
 *
 * «Free» is `busyWith` — the one answer to «занят ли человек» shared with
 * «Беру» and the weekend assignment, so the surfaces cannot drift. It sees the
 * night shift of the day before (H7) and treats an entry without times as its
 * whole day: an absence has no hours, and «пересечения нет» would offer the
 * shift to somebody on holiday.
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
  const pool = new Set(shift.templateId != null ? getTemplateRoles(db, shift.templateId).pool : []);

  return listActive(db)
    .filter((employee) => employee.id !== shift.employeeId && !excluded.has(employee.id) && canSwap(employee))
    .filter((employee) => busyWith(db, employee.id, shift, { ignoreEntryId: shift.id }) == null)
    .sort((a, b) => Number(pool.has(b.id)) - Number(pool.has(a.id)) || a.id - b.id);
}
