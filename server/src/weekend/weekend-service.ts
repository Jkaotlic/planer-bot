import { eq } from "drizzle-orm";
import { shiftDurationHours } from "@planer/shared";
import type { Db } from "../db/client";
import { weekendAssignments, type VacantSlot, type WeekendAssignment } from "../db/schema";
import {
  createVacantSlot,
  listOpenSlots,
  getVacantSlot,
  setSlotStatus,
  addInterest,
  listInterestedEmployeeIds,
  listMyInterestSlotIds,
  createAssignment,
  confirmAssignment,
  listAssignmentsForEmployee,
  listAssignmentsForSlot,
  listConfirmedInRange,
  countConfirmedByEmployeeInMonth,
  countPassedOver,
  getAssignment,
  findAssignment,
  deleteAssignment,
  reofferAssignment,
  setAssignmentShift,
} from "../repo/weekend";
import { createShift, deleteShift } from "../repo/shifts";
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

export function expressInterest(db: Db, slotId: number, employeeId: number): Outcome {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return { ok: false, reason: "not_found" };
  if (slot.status !== "open") return { ok: false, reason: "not_open" };
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
): { employeeId: number; name: string; confirmedThisMonth: number; passedOver: number }[] {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return [];
  const month = monthOf(slot.date);
  return listInterestedEmployeeIds(db, slotId)
    .map((employeeId) => ({
      employeeId,
      name: getEmployeeById(db, employeeId)?.displayName ?? "Неизвестно",
      confirmedThisMonth: countConfirmedByEmployeeInMonth(db, employeeId, month),
      passedOver: countPassedOver(db, employeeId),
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
export function assignSlot(db: Db, slotId: number, employeeId: number): AssignOutcome {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return { ok: false, reason: "not_found" };
  if (slot.status === "closed") return { ok: false, reason: "not_open" };
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
}

/** Admin removes someone from a slot: drops their schedule entry and the assignment. */
export function unassign(db: Db, assignmentId: number): UnassignOutcome {
  const assignment = getAssignment(db, assignmentId);
  if (!assignment) return { ok: false, reason: "not_found" };
  if (assignment.shiftId != null) deleteShift(db, assignment.shiftId);
  deleteAssignment(db, assignmentId);
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
  return { ok: true, slotId: assignment.slotId };
}

export function declineOffer(db: Db, assignmentId: number, actingEmployeeId: number): ConfirmOutcome {
  const assignment = listAssignmentsForEmployee(db, actingEmployeeId).find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: "not_yours" };
  if (assignment.status !== "offered") return { ok: false, reason: "not_offered" };
  // Turning it down pulls the entry back out of the schedule; the slot itself stays
  // open for someone else (it was never closed by assigning).
  if (assignment.shiftId != null) deleteShift(db, assignment.shiftId);
  db.update(weekendAssignments)
    .set({ status: "declined", shiftId: null })
    .where(eq(weekendAssignments.id, assignmentId))
    .run();
  return { ok: true, slotId: assignment.slotId };
}

export function payrollRows(
  db: Db,
  from: string,
  to: string,
): { employeeId: number; employeeName: string; date: string; hours: number }[] {
  const rows = listConfirmedInRange(db, from, to).map((a) => {
    const slot = getVacantSlot(db, a.slotId);
    return {
      employeeId: a.employeeId,
      employeeName: getEmployeeById(db, a.employeeId)?.displayName ?? "Неизвестно",
      date: slot?.date ?? "",
      hours: a.hours,
    };
  });
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
