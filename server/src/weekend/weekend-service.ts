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
  listConfirmedInRange,
  countConfirmedByEmployeeInMonth,
  countPassedOver,
} from "../repo/weekend";
import { createShift } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";

export type Outcome = { ok: true } | { ok: false; reason: string };
export type AssignOutcome = { ok: true; assignment: WeekendAssignment } | { ok: false; reason: string };

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

export function assignSlot(db: Db, slotId: number, employeeId: number): AssignOutcome {
  const slot = getVacantSlot(db, slotId);
  if (!slot) return { ok: false, reason: "not_found" };
  if (slot.status !== "open") return { ok: false, reason: "not_open" };
  if (!listInterestedEmployeeIds(db, slotId).includes(employeeId)) return { ok: false, reason: "not_interested" };
  const hours = shiftDurationHours({ start: slot.start, end: slot.end });
  const assignment = createAssignment(db, { slotId, employeeId, hours });
  setSlotStatus(db, slotId, "assigned");
  return { ok: true, assignment };
}

export function confirmOffer(db: Db, assignmentId: number, actingEmployeeId: number): Outcome {
  const assignment = listAssignmentsForEmployee(db, actingEmployeeId).find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: "not_yours" };
  if (assignment.status !== "offered") return { ok: false, reason: "not_offered" };
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
  return { ok: true };
}

export function declineOffer(db: Db, assignmentId: number, actingEmployeeId: number): Outcome {
  const assignment = listAssignmentsForEmployee(db, actingEmployeeId).find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: "not_yours" };
  if (assignment.status !== "offered") return { ok: false, reason: "not_offered" };
  db.update(weekendAssignments).set({ status: "declined" }).where(eq(weekendAssignments.id, assignmentId)).run();
  setSlotStatus(db, assignment.slotId, "open");
  return { ok: true };
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

export function openSlotsForWorker(
  db: Db,
  employeeId: number,
  fromDate: string,
): { slot: VacantSlot; interested: boolean }[] {
  const mine = new Set(listMyInterestSlotIds(db, employeeId));
  return listOpenSlots(db, fromDate).map((slot) => ({ slot, interested: mine.has(slot.id) }));
}

export function myOffers(db: Db, employeeId: number): { assignment: WeekendAssignment; slot: VacantSlot }[] {
  return listAssignmentsForEmployee(db, employeeId)
    .filter((a) => a.status === "offered" || a.status === "confirmed")
    .map((a) => ({ assignment: a, slot: getVacantSlot(db, a.slotId) }))
    .filter((x): x is { assignment: WeekendAssignment; slot: VacantSlot } => x.slot != null);
}
