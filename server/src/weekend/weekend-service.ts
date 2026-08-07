import { eq } from "drizzle-orm";
import { shiftDurationHours, isWeekend, isAbsence, type EntryCategory } from "@planer/shared";
import type { Db } from "../db/client";
import { weekendAssignments, type VacantSlot, type WeekendAssignment } from "../db/schema";
import {
  createVacantSlot,
  listOpenSlots,
  getVacantSlot,
  addInterest,
  listInterestedEmployeeIds,
  listMyInterestSlotIds,
  createAssignment,
  confirmAssignment,
  listAssignmentsForEmployee,
  listAssignmentsForSlot,
  listConfirmedWorkInRange,
  countConfirmedByEmployeeInMonth,
  countPassedOver,
  getAssignment,
  findAssignment,
  deleteAssignment,
  reofferAssignment,
  setAssignmentShift,
} from "../repo/weekend";
import { createShift, deleteShift, listShiftsOverlapping } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";

export type Outcome = { ok: true } | { ok: false; reason: string };
/** `changed` is false only for the true no-op branch below (already assigned, nothing
 *  written) — callers use it to skip re-notifying the worker on a repeat "Назначить". */
export type AssignOutcome = { ok: true; assignment: WeekendAssignment; changed: boolean } | { ok: false; reason: string };
/** `slotId` lets callers build a "<name> confirmed/declined <slot>" admin
 *  broadcast without a second lookup. */
export type ConfirmOutcome = { ok: true; slotId: number } | { ok: false; reason: string };
/** `employeeId`/`slotId` let callers notify the worker who was just taken off
 *  the slot — their assignment row is gone the moment this returns. */
export type UnassignOutcome = { ok: true; employeeId: number; slotId: number } | { ok: false; reason: string };

/** "2026-07-14" -> "2026-07". */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function postSlot(
  db: Db,
  data: { date: string; start: string; end: string; title?: string | null; location?: string | null; note?: string | null },
): VacantSlot {
  if (!data.date || !data.start || !data.end) throw new Error("date, start and end are required");
  return createVacantSlot(db, data);
}

/**
 * Whether this person may still take part in the weekend market at all.
 *
 * The bot's buttons and the HTTP middleware each refuse an archived person at
 * their own door, but the door they guard is the *actor's*: an admin assigning
 * somebody is an active actor picking a target, and nothing looked at the target.
 * The rule belongs where the decision is made, not only where the request enters.
 */
function isOnStaff(db: Db, employeeId: number): boolean {
  return getEmployeeById(db, employeeId)?.isActive === true;
}

/**
 * Whether this slot can still be acted on at all, or `null` if it can.
 *
 * A day off that has already been and gone can't be volunteered for or handed to
 * anybody — and every posted slot leaves a «🙋 Хочу» button sitting in everybody's
 * Telegram chat, where it stays live forever. The mini-app stops listing a slot
 * once its date passes; the button doesn't, so the rule has to be here.
 *
 * The weekend check is here for the same reason: writing the `weekend_work` entry
 * is the marketplace's own path into the schedule, and it never passes through
 * `createEntrySchema`, which is what enforces «только суббота или воскресенье» on
 * the other path. Two ways in, one rule each.
 */
function slotUnusableReason(slot: VacantSlot, today: string): string | null {
  if (slot.date < today) return "slot_passed";
  if (!isWeekend(slot.date)) return "not_weekend";
  return null;
}

export function expressInterest(db: Db, slotId: number, employeeId: number, today: string): Outcome {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return { ok: false, reason: "not_found" };
  if (slot.status !== "open") return { ok: false, reason: "not_open" };
  const unusable = slotUnusableReason(slot, today);
  if (unusable) return { ok: false, reason: unusable };
  if (!isOnStaff(db, employeeId)) return { ok: false, reason: "not_active" };
  addInterest(db, slotId, employeeId);
  return { ok: true };
}

/**
 * Who wants this slot, fairest first. Fairness here is "how many weekends have you
 * actually worked this month" — fewest first, so the same people don't collect every
 * weekend. Ties go to whoever has been passed over most often (volunteered but lost
 * the slot to someone else), so a keen volunteer isn't skipped forever.
 */
export function interestedForSlot(
  db: Db,
  slotId: number,
): { employeeId: number; name: string; confirmedThisMonth: number; passedOver: number; absence: EntryCategory | null }[] {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return [];
  const month = monthOf(slot.date);
  // Who is away that day. Not a filter and not a block: somebody can volunteer in
  // May and have a June vacation land on the slot, and sometimes a person asks to
  // come in anyway — that is the admin's call. But making it their call requires
  // showing it, and the list said nothing at all.
  const awayThatDay = new Map<number, EntryCategory>();
  for (const entry of listShiftsOverlapping(db, slot.date, slot.date)) {
    if (entry.employeeId != null && isAbsence(entry.category)) awayThatDay.set(entry.employeeId, entry.category);
  }
  return listInterestedEmployeeIds(db, slotId)
    // Somebody who volunteered and has since been archived is not a candidate;
    // showing the name unmarked invites the admin to pick it.
    .filter((employeeId) => isOnStaff(db, employeeId))
    .map((employeeId) => ({
      employeeId,
      name: getEmployeeById(db, employeeId)?.displayName ?? "Неизвестно",
      confirmedThisMonth: countConfirmedByEmployeeInMonth(db, employeeId, month),
      passedOver: countPassedOver(db, employeeId),
      absence: awayThatDay.get(employeeId) ?? null,
    }))
    .sort(
      (a, b) =>
        a.confirmedThisMonth - b.confirmedThisMonth || b.passedOver - a.passedOver || a.employeeId - b.employeeId,
    );
}

/**
 * Puts a worker on a slot. A slot can take several people, so this does NOT close
 * it — it stays visible with its assignees, and the admin can add or swap people.
 * The weekend_work entry is created immediately, so the assignment shows up in the
 * schedule straight away; confirm/decline only settles whether the worker accepts.
 */
export function assignSlot(db: Db, slotId: number, employeeId: number, today: string): AssignOutcome {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return { ok: false, reason: "not_found" };
  if (slot.status === "closed") return { ok: false, reason: "not_open" };
  const unusable = slotUnusableReason(slot, today);
  if (unusable) return { ok: false, reason: unusable };
  if (!isOnStaff(db, employeeId)) return { ok: false, reason: "not_active" };
  // Through the UI this can't be reached — an excluded person never got the call
  // and never tapped «Хочу» — but the route takes an employeeId from the request
  // body, so the door has to be shut here too.
  if (getEmployeeById(db, employeeId)?.excludedFromAssignment === true) return { ok: false, reason: "excluded" };
  if (!listInterestedEmployeeIds(db, slotId).includes(employeeId)) return { ok: false, reason: "not_interested" };

  // slotId+employeeId is unique, so a second assign for the same pair always lands here.
  const existing = findAssignment(db, slotId, employeeId);

  // Already on the slot with a live shift entry: a double-tap of "Назначить" (or
  // re-assigning someone who already confirmed) changes nothing. In particular this
  // never bounces a confirmed worker back to "offered" — they didn't decline, so
  // demanding a fresh confirmation would be a false "please reconfirm".
  if (existing && existing.status !== "declined" && existing.shiftId != null) {
    return { ok: true, assignment: existing, changed: false };
  }

  // The schedule entry and the assignment that explains it are one fact written to
  // two tables: an entry no assignment accounts for shows the slot as unstaffed
  // while the person's calendar says they work it.
  return db.transaction(() => {
    const shift = createShift(db, {
      date: slot.date,
      start: slot.start,
      end: slot.end,
      category: "weekend_work",
      employeeId,
      title: slot.title ?? "Работа в выходной",
      location: slot.location,
    });

    if (existing) {
      if (existing.status === "declined") {
        // Re-offering someone who previously declined reuses their row (slot+employee is unique).
        reofferAssignment(db, existing.id, shift.id);
        return { ok: true, assignment: { ...existing, status: "offered", shiftId: shift.id, confirmedAt: null }, changed: true };
      }
      // offered/confirmed but its shift link had gone missing (e.g. the schedule entry was
      // deleted directly) — repair the link without touching status or creating a duplicate.
      setAssignmentShift(db, existing.id, shift.id);
      return { ok: true, assignment: { ...existing, shiftId: shift.id }, changed: true };
    }

    const hours = shiftDurationHours({ start: slot.start, end: slot.end });
    const assignment = createAssignment(db, { slotId, employeeId, hours });
    setAssignmentShift(db, assignment.id, shift.id);
    return { ok: true, assignment: { ...assignment, shiftId: shift.id }, changed: true };
  });
}

/** Admin removes someone from a slot: drops their schedule entry and the assignment. */
export function unassign(db: Db, assignmentId: number): UnassignOutcome {
  const assignment = getAssignment(db, assignmentId);
  if (!assignment) return { ok: false, reason: "not_found" };
  // Both or neither: an assignment whose entry is gone puts somebody on the slot
  // with nothing in their schedule.
  db.transaction(() => {
    if (assignment.shiftId != null) deleteShift(db, assignment.shiftId);
    deleteAssignment(db, assignmentId);
  });
  return { ok: true, employeeId: assignment.employeeId, slotId: assignment.slotId };
}

/** Who is on this slot right now (declined people drop off), for admins and workers alike. */
export function assigneesForSlot(
  db: Db,
  slotId: number,
): { assignmentId: number; employeeId: number; name: string; status: "offered" | "confirmed" }[] {
  return listAssignmentsForSlot(db, slotId)
    .filter((a) => a.status !== "declined")
    .map((a) => ({
      assignmentId: a.id,
      employeeId: a.employeeId,
      name: getEmployeeById(db, a.employeeId)?.displayName ?? "Неизвестно",
      status: a.status as "offered" | "confirmed",
    }));
}

export function confirmOffer(db: Db, assignmentId: number, actingEmployeeId: number): ConfirmOutcome {
  const assignment = listAssignmentsForEmployee(db, actingEmployeeId).find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: "not_yours" };
  if (assignment.status !== "offered") return { ok: false, reason: "not_offered" };
  // The entry was created when the admin assigned it; accepting just records that.
  if (assignment.shiftId != null) {
    confirmAssignment(db, assignmentId, assignment.shiftId);
    return { ok: true, slotId: assignment.slotId };
  }
  const slot = getVacantSlot(db, assignment.slotId);
  if (!slot) return { ok: false, reason: "slot_missing" };
  // Both or neither. Half of this leaves the offer `offered` with no shift link and
  // an orphan entry in the schedule — and the next «Назначить» writes a *second*
  // entry for the same day.
  db.transaction(() => {
    const shift = createShift(db, {
      date: slot.date,
      start: slot.start,
      end: slot.end,
      category: "weekend_work",
      employeeId: actingEmployeeId,
      title: slot.title ?? "Работа в выходной",
      location: slot.location,
    });
    confirmAssignment(db, assignmentId, shift.id);
  });
  return { ok: true, slotId: assignment.slotId };
}

export function declineOffer(db: Db, assignmentId: number, actingEmployeeId: number): ConfirmOutcome {
  const assignment = listAssignmentsForEmployee(db, actingEmployeeId).find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: "not_yours" };
  if (assignment.status !== "offered") return { ok: false, reason: "not_offered" };
  // Turning it down pulls the entry back out of the schedule; the slot itself stays
  // open for someone else (it was never closed by assigning).
  db.transaction(() => {
    if (assignment.shiftId != null) deleteShift(db, assignment.shiftId);
    db.update(weekendAssignments)
      .set({ status: "declined", shiftId: null })
      .where(eq(weekendAssignments.id, assignmentId))
      .run();
  });
  return { ok: true, slotId: assignment.slotId };
}

/**
 * What to pay for, read off the schedule.
 *
 * Date and hours come from the entry, not from `weekendAssignments.hours` — that
 * column is the figure at the moment of assigning, and an admin who shortens or
 * moves the shift edits the schedule, which is where they look and what they
 * expect to matter. See `listConfirmedWorkInRange`.
 */
export function payrollRows(
  db: Db,
  from: string,
  to: string,
): { employeeId: number; employeeName: string; date: string; hours: number }[] {
  const rows = listConfirmedWorkInRange(db, from, to).map((work) => ({
    employeeId: work.employeeId,
    employeeName: getEmployeeById(db, work.employeeId)?.displayName ?? "Неизвестно",
    date: work.date,
    // A weekend entry always carries times (both write paths insist on it), so a
    // null here would be a row nobody can price — count it as nothing rather than NaN.
    hours: work.start != null && work.end != null ? shiftDurationHours({ start: work.start, end: work.end }) : 0,
  }));
  return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.localeCompare(b.date));
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function payrollCsv(rows: { employeeName: string; date: string; hours: number }[]): string {
  const lines = rows.map((r) => [csvField(r.employeeName), r.date, String(r.hours)].join(","));
  return ["Работник,Дата,Часы", ...lines].join("\n");
}

/**
 * The open slots as a worker sees them: whether they've raised their hand, and who
 * is already going — everyone should be able to see who works which weekend, not
 * just admins.
 */
export function openSlotsForWorker(
  db: Db,
  employeeId: number,
  fromDate: string,
): { slot: VacantSlot; interested: boolean; assignees: { employeeId: number; name: string; status: string }[] }[] {
  const mine = new Set(listMyInterestSlotIds(db, employeeId));
  return listOpenSlots(db, fromDate).map((slot) => ({
    slot,
    interested: mine.has(slot.id),
    assignees: assigneesForSlot(db, slot.id).map(({ employeeId: id, name, status }) => ({ employeeId: id, name, status })),
  }));
}

export function myOffers(db: Db, employeeId: number): { assignment: WeekendAssignment; slot: VacantSlot }[] {
  return listAssignmentsForEmployee(db, employeeId)
    .filter((a) => a.status === "offered" || a.status === "confirmed")
    .map((a) => ({ assignment: a, slot: getVacantSlot(db, a.slotId) }))
    .filter((x): x is { assignment: WeekendAssignment; slot: VacantSlot } => x.slot != null);
}
