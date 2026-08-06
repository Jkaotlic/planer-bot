import type { Db } from "../db/client";
import type { EntryCategory } from "@planer/shared";
import { listActiveInRosterOrder } from "./employees";
import { listShiftsOverlapping } from "./shifts";

/** Запись расписания в том виде, в каком её можно показывать любому работнику. */
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
  employees: { id: number; displayName: string; rosterOrder: number | null }[];
  shifts: TeamScheduleEntry[];
}

/**
 * Расписание команды за окно дат — один источник и для `/api/team/schedule`, и
 * для картинки недели, которую бот шлёт по `/week`.
 *
 * Две вещи, ради которых это не «просто select»:
 *
 * 1. Архивирование снимает человека со смен только начиная с даты архива, так
 *    что прошлые за ним остаются — это настоящая история, и отчёты её читают.
 *    Но сетку рисуют по активным людям, поэтому такая запись не может попасть
 *    ни в одну строку: раньше она доезжала до клиента только чтобы там быть
 *    выброшенной.
 * 2. `note` — свободное админское поле, и за пределами админских экранов его
 *    никто читать не должен. Поэтому здесь именно перечисление полей, а не
 *    сырая строка.
 */
export function readTeamSchedule(db: Db, from: string, to: string): TeamScheduleView {
  const active = listActiveInRosterOrder(db);
  const employees = active.map((employee) => ({
    id: employee.id,
    displayName: employee.displayName,
    rosterOrder: employee.rosterOrder,
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
  return { employees, shifts };
}
