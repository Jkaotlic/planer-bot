import type { Db } from "../db/client";
import { canSwap, type EntryCategory } from "@planer/shared";
import { listActiveInRosterOrder } from "./employees";
import { listShiftsOverlapping } from "./shifts";
import { listCalendarDays } from "./calendar-days";

/** A schedule entry shaped so it's safe to show to any worker. */
export interface TeamScheduleEntry {
  id: number;
  date: string;
  start: string | null;
  end: string | null;
  endDate: string | null;
  category: EntryCategory;
  title: string | null;
  location: string | null;
  unrecognisedCode: string | null;
  templateId: number | null;
  employeeId: number | null;
}

export interface TeamScheduleView {
  employees: { id: number; displayName: string; rosterOrder: number | null; excludedFromSwaps: boolean }[];
  shifts: TeamScheduleEntry[];
  /** Праздники и рабочие субботы окна — исключения из правила «Сб/Вс». */
  calendar: { date: string; kind: "holiday" | "workday"; note: string | null; source: "auto" | "manual" }[];
}

/**
 * Team schedule for a date window — the one source both `/api/team/schedule`
 * and the week image the bot sends for `/week` read from.
 *
 * Two things keep this from being "just a select":
 *
 * 1. Archiving only unassigns shifts from the archive date onward, so an
 *    archived person keeps their past ones — real history, and the reports
 *    still read it. The grid, though, draws its rows from the active
 *    employees, so such an entry can never land in a row: it used to reach
 *    the client only to be dropped on arrival.
 * 2. `note` is a free-text admin field nobody outside the admin screens
 *    should read. That's why this lists fields explicitly instead of
 *    spreading the raw row — keep this in sync with what the miniapp/admin
 *    `Shift` types actually declare.
 */
export function readTeamSchedule(db: Db, from: string, to: string): TeamScheduleView {
  const active = listActiveInRosterOrder(db);
  const employees = active.map((employee) => ({
    id: employee.id,
    displayName: employee.displayName,
    rosterOrder: employee.rosterOrder,
    // Эффективное, а не поле строки: сетка гасит «Обменять» на чужой смене
    // этим значением, и роль наблюдателя обязана перекрывать снятую галочку —
    // тем же правилом, что и в `GET /api/me`.
    excludedFromSwaps: !canSwap(employee),
  }));
  const activeIds = new Set(active.map((employee) => employee.id));
  const shifts = listShiftsOverlapping(db, from, to)
    .filter((shift) => shift.employeeId == null || activeIds.has(shift.employeeId))
    .map((shift) => ({
      id: shift.id,
      date: shift.date,
      start: shift.start,
      end: shift.end,
      endDate: shift.endDate,
      category: shift.category,
      title: shift.title,
      location: shift.location,
      unrecognisedCode: shift.unrecognisedCode,
      templateId: shift.templateId,
      employeeId: shift.employeeId,
    }));
  const calendar = listCalendarDays(db, from, to).map(({ date, kind, note, source }) => ({ date, kind, note, source }));
  return { employees, shifts, calendar };
}
