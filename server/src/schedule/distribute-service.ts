import { eq } from "drizzle-orm";
import {
  allowedByPool,
  distributeFairly,
  countsForBalance,
  isAbsence,
  nextDate,
  toMinutes,
  type FillSlot,
  type WorkerLoad,
} from "@planer/shared";
import type { Db } from "../db/client";
import { shifts } from "../db/schema";
import { listUnassignedShifts, listShiftsByEmployee } from "../repo/shifts";
import { listActive, getEmployeeById } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { getAllTemplateRoles } from "../repo/template-roles";

export interface DistributionAssignment {
  shiftId: number;
  employeeId: number;
  employeeName: string;
}

/**
 * Why a slot came back empty.
 *
 * `empty_pool` is a misconfigured preset — its pool lists only people who are no
 * longer on the roster, so nobody at all may take this kind. Archiving does not
 * clear pool rows (deliberately: an empty pool would then read as «все», handing a
 * duty to anyone, and a restore would silently lose the membership), which is
 * exactly why this has to be *said* rather than fixed behind the admin's back.
 *
 * `nobody_free` is ordinary life: everyone eligible is away or already busy at
 * that hour. Nothing to fix, and nothing to worry about.
 */
export type UnfilledReason = "empty_pool" | "nobody_free";

export interface UnfilledSlot {
  shiftId: number;
  date: string;
  kind: string;
  reason: UnfilledReason;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Expands an inclusive YYYY-MM-DD range to every date it covers, clamped to [from, to]. Deterministic (no wall-clock reads). */
function expandDateRange(start: string, end: string, from: string, to: string): string[] {
  const clampedStart = start < from ? from : start;
  const clampedEnd = end > to ? to : end;
  if (clampedStart > clampedEnd) return [];
  const [sy, sm, sd] = clampedStart.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = clampedEnd.split("-").map(Number) as [number, number, number];
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Which kind of shift this is, for per-kind fairness. Prefer the preset it was
 * created from; fall back to its title (older rows predate templateId being
 * stored), and finally to a single bucket for one-off custom times.
 */
function shiftKind(
  s: { templateId: number | null; title: string | null },
  nameById: ReadonlyMap<number, string>,
): string {
  if (s.templateId != null) {
    const name = nameById.get(s.templateId);
    if (name) return name;
  }
  return s.title ?? "Своё время";
}

/**
 * A roster cell the import could not read (`unrecognisedCode` set, no times — see
 * the column comment on `shifts`). It is real work of an unknown kind, so it must
 * add to the total the same as any other shift, but it must never be filed under a
 * named kind (that would claim to know what it was) or under the custom-time
 * bucket (that means somebody hand-timed a shift, which this is not). Keep this in
 * sync with the identical bucket in reports/shift-counts.ts — same meaning, same
 * label, so the report and the balance never disagree about what this is.
 */
const UNRECOGNISED_KIND = "Не распознано (?)";

function crossesMidnight(start: string, end: string): boolean {
  return toMinutes(end) < toMinutes(start);
}

function seedWorkerLoad(
  db: Db,
  employeeId: number,
  from: string,
  to: string,
  nameById: ReadonlyMap<number, string>,
): WorkerLoad {
  const employeeShifts = listShiftsByEmployee(db, employeeId);
  const byKind: Record<string, number> = {};
  let total = 0;

  // One shift, one count — filed under «не распознано» when it carries that mark,
  // exactly as reports/shift-counts.ts files it, so the balance and the report can
  // never disagree about what an unread cell is.
  //
  // An unread cell normally has no times (the import is the only thing that may
  // create one, and it deliberately invents none), which is why it has to be let in
  // here despite failing the times check — otherwise it vanishes from the count and
  // undercounts this person against every kind of comparison. But «unread» and
  // «timed» are not exclusive in practice: a cell edited before the «правка снимает
  // пометку» fix kept its mark and gained hours, and the live schedule holds one
  // such row. Counting it in a second pass added it twice, and an inflated total
  // reads as «этот уже загружен» — so fair distribution handed that person fewer
  // shifts than they were owed.
  const counted = employeeShifts.filter(
    (s) => inRange(s.date, from, to) && (s.unrecognisedCode != null || (s.start != null && s.end != null)),
  );
  for (const s of counted) {
    if (!countsForBalance(s.category)) continue;
    const kind = s.unrecognisedCode != null ? UNRECOGNISED_KIND : shiftKind(s, nameById);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    total += 1;
  }

  // Busy also needs a genuinely overnight shift dated the day *before* `from` —
  // its tail still lands inside the window even though its own date does not.
  // shiftsOverlap/shiftInterval already do the cross-midnight maths correctly once
  // a shift reaches `busy`; this only widens which shifts make it there. Counting
  // (above) deliberately stays keyed on the shift's own date, so a boundary shift
  // is never counted twice by two adjacent periods.
  const busyTimed = employeeShifts.filter(
    (s) =>
      s.start != null && s.end != null &&
      (inRange(s.date, from, to) || (nextDate(s.date) === from && crossesMidnight(s.start, s.end))),
  );
  const busy = busyTimed.map((s) => ({ date: s.date, start: s.start as string, end: s.end as string }));

  // Absences reach one day PAST `to`, mirroring the way `busy` above reaches one
  // day back before `from`. A slot dated `to` that crosses midnight occupies `to`+1
  // as well (see datesOf in shared/distribute), and distributeFairly does check
  // both dates — but it can only see what seeding hands it. Clamped at `to`, the
  // window's last night fell back into exactly the bug the overnight fix closed:
  // a vacation starting the next morning is not merely un-expanded, it fails
  // `overlapsRange` and is never loaded at all. Widening only ever adds `to`+1,
  // and nothing but an overnight slot dated `to` can match it.
  const absenceTo = nextDate(to);
  const absences = employeeShifts.filter((s) => isAbsence(s.category) && overlapsRange(s, from, absenceTo));
  const absentDatesSet = new Set<string>();
  for (const s of absences) {
    const end = s.endDate ?? s.date;
    for (const d of expandDateRange(s.date, end, from, absenceTo)) absentDatesSet.add(d);
  }
  // An unread cell with no times has no interval to compare for overlap — "busy"
  // can't express it. Blocking the whole day is the safe reading: we know this
  // person has *something* that day, so a second commitment could collide at any
  // hour. `absentDates` is reused rather than inventing a fabricated all-day busy
  // interval because it is already exactly "assign this person nothing on this
  // date", and its only reader is distributeFairly below — nothing else in the
  // codebase interprets WorkerLoad.absentDates as "on vacation", so widening its
  // source doesn't leak a wrong meaning anywhere.
  //
  // One that *does* carry times is a different matter: it is already in `busy` with
  // a real interval, which is strictly more precise than blocking the whole day.
  for (const s of employeeShifts) {
    if (s.unrecognisedCode != null && s.start == null && s.end == null && inRange(s.date, from, to)) {
      absentDatesSet.add(s.date);
    }
  }
  const absentDates = [...absentDatesSet];

  return { employeeId, byKind, total, busy, absentDates };
}

/** An absence entry overlaps [from, to] if its range [date, endDate ?? date] intersects it. */
function overlapsRange(s: { date: string; endDate: string | null }, from: string, to: string): boolean {
  const end = s.endDate ?? s.date;
  return s.date <= to && end >= from;
}

/**
 * Proposes assignments for unfilled 'shift' slots in [from, to]. Fairness is judged
 * per shift kind (Утро/День/Вечер/Ночь), not by hours — so nobody collects all the
 * nights while the hour totals still look even.
 */
export function buildDistribution(
  db: Db,
  from: string,
  to: string,
): { assignments: DistributionAssignment[]; unfilled: UnfilledSlot[] } {
  const nameById = new Map(listActiveTemplates(db).map((t) => [t.id, t.name]));
  // Who may take each preset, and who asked for it. Read once for the whole run
  // rather than per slot. A slot with no preset behind it has no roles to apply,
  // which the distributor reads as "everyone" — the same as an empty pool.
  const rolesByTemplate = getAllTemplateRoles(db);

  const unassigned = listUnassignedShifts(db, from, to);
  const slots: FillSlot[] = unassigned.map((s) => {
    const roles = s.templateId != null ? rolesByTemplate.get(s.templateId) : undefined;
    return {
      id: s.id,
      date: s.date,
      start: s.start as string,
      end: s.end as string,
      kind: shiftKind(s, nameById),
      pool: roles?.pool ?? null,
      preference: roles?.preference ?? null,
    };
  });

  // Everyone the roster still counts — including people an admin took out of
  // automatic assignment. Kept separate from `workers` below because the
  // `empty_pool` / `nobody_free` split below is judged against this list.
  const active = listActive(db);
  const workers = active
    .filter((employee) => !employee.excludedFromAssignment)
    .map((e) => seedWorkerLoad(db, e.id, from, to, nameById));

  const chosen = distributeFairly(slots, workers);
  const assignments = chosen.map((a) => ({
    shiftId: a.shiftId,
    employeeId: a.employeeId,
    employeeName: getEmployeeById(db, a.employeeId)?.displayName ?? "",
  }));

  // Whatever distributeFairly walked past. It leaves such a slot alone by design;
  // the admin still has to hear about it, or «Распределено смен: 3» over five empty
  // cells is the only clue that anything went wrong.
  const filled = new Set(chosen.map((a) => a.shiftId));
  const unfilled: UnfilledSlot[] = slots
    .filter((slot) => !filled.has(slot.id))
    .map((slot) => ({
      shiftId: slot.id,
      date: slot.date,
      kind: slot.kind,
      // Told apart on eligibility alone — being busy or away is a fact about a day,
      // being outside every pool is a fact about the preset.
      //
      // Judged over ALL active people, not over `workers`: `empty_pool` means the
      // preset lists nobody who is on the roster — a misconfiguration. A pool of
      // people who are merely excluded from assignment is configured correctly and
      // simply has nobody available, which is what `nobody_free` says.
      reason: active.some((employee) => allowedByPool(slot.pool, employee.id)) ? "nobody_free" : "empty_pool",
    }));

  return { assignments, unfilled };
}

/** Applies a proposed distribution, writing employeeId on each shift in one transaction. */
export function applyDistribution(db: Db, assignments: { shiftId: number; employeeId: number }[]): void {
  db.transaction((tx) => {
    for (const a of assignments) {
      tx.update(shifts).set({ employeeId: a.employeeId }).where(eq(shifts.id, a.shiftId)).run();
    }
  });
}
