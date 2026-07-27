import {
  exactSchedulePalette,
  isAbsence,
  type EntryCategory,
  type SchedulePalette,
} from "@planer/shared";
import type { Shift, TeamEmployee, TeamSchedule, Template } from "../api/client";
import { addDays, mondayOf, toISODate } from "./week";

export type TeamMode = "today" | "week";

export interface TeamRange {
  from: string;
  to: string;
}

export interface TeamPerson {
  employeeId: number | null;
  displayName: string;
  rosterOrder: number;
}

export interface TeamEntryView {
  shift: Shift;
  title: string;
  palette: SchedulePalette | null;
}

export interface TodayGroup {
  key: string;
  title: string;
  start: string | null;
  end: string | null;
  palette: SchedulePalette | null;
  people: TeamPerson[];
  entries: TeamEntryView[];
}

export interface TodayModel {
  groups: TodayGroup[];
  noTimeGroups: TodayGroup[];
  workingCount: number;
  absentCount: number;
}

export interface WeekCell {
  date: string;
  entries: TeamEntryView[];
  primary: TeamEntryView | null;
  extraCount: number;
}

export interface WeekRow {
  employeeId: number | null;
  displayName: string;
  cells: WeekCell[];
}

export interface WeekModel {
  days: string[];
  rows: WeekRow[];
}

type ScheduleTemplate = Pick<Template, "id" | "name" | "accent" | "sortOrder">;

const CATEGORY_TITLES: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выездное мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function coversDate(shift: Shift, date: string): boolean {
  return shift.date <= date && (shift.endDate ?? shift.date) >= date;
}

export function splitDisplayName(displayName: string): { surname: string; rest: string } {
  const [surname = displayName, ...rest] = displayName.trim().split(/\s+/);
  return { surname, rest: rest.join(" ") };
}

export function teamRange(mode: TeamMode, selectedDate: string): TeamRange {
  if (mode === "today") return { from: selectedDate, to: selectedDate };
  const monday = mondayOf(new Date(`${selectedDate}T12:00:00`));
  return { from: toISODate(monday), to: toISODate(addDays(monday, 6)) };
}

function templateFor(
  shift: Shift,
  templates: readonly ScheduleTemplate[],
): ScheduleTemplate | undefined {
  return shift.templateId == null
    ? undefined
    : templates.find((template) => template.id === shift.templateId);
}

function toEntryView(
  shift: Shift,
  templates: readonly ScheduleTemplate[],
): TeamEntryView {
  const template = templateFor(shift, templates);
  return {
    shift,
    title: template?.name ?? shift.title ?? CATEGORY_TITLES[shift.category],
    palette: exactSchedulePalette(template?.accent, shift.category),
  };
}

function groupingKey(shift: Shift): string {
  if (shift.templateId != null) return `template:${shift.templateId}`;
  return [
    "custom",
    shift.category,
    shift.title ?? "",
    shift.start ?? "",
    shift.end ?? "",
    shift.location ?? "",
  ].join(":");
}

function compareShifts(
  a: Shift,
  b: Shift,
  templates: readonly ScheduleTemplate[],
): number {
  const byStart = (a.start ?? "99:99").localeCompare(b.start ?? "99:99");
  if (byStart !== 0) return byStart;
  const aOrder = templateFor(a, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = templateFor(b, templates)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return toEntryView(a, templates).title.localeCompare(toEntryView(b, templates).title, "ru");
}

function employeeRank(employee: TeamEmployee, index: number): number {
  return employee.rosterOrder ?? 1_000_000 + index;
}

function personFor(
  employeeId: number | null,
  employees: readonly TeamEmployee[],
): TeamPerson {
  if (employeeId == null) {
    return {
      employeeId: null,
      displayName: "Не назначено",
      rosterOrder: Number.MAX_SAFE_INTEGER,
    };
  }
  const index = employees.findIndex((employee) => employee.id === employeeId);
  const employee = employees[index];
  return {
    employeeId,
    displayName: employee?.displayName ?? "Сотрудник вне активного ростера",
    rosterOrder: employee ? employeeRank(employee, index) : Number.MAX_SAFE_INTEGER - 1,
  };
}

function groupEntries(
  shifts: readonly Shift[],
  employees: readonly TeamEmployee[],
  templates: readonly ScheduleTemplate[],
): TodayGroup[] {
  const grouped = new Map<string, TodayGroup>();
  for (const shift of [...shifts].sort((a, b) => compareShifts(a, b, templates))) {
    const key = groupingKey(shift);
    const entry = toEntryView(shift, templates);
    const group = grouped.get(key) ?? {
      key,
      title: entry.title,
      start: shift.start,
      end: shift.end,
      palette: entry.palette,
      people: [],
      entries: [],
    };
    group.entries.push(entry);
    const person = personFor(shift.employeeId, employees);
    if (!group.people.some((candidate) => candidate.employeeId === person.employeeId)) {
      group.people.push(person);
      group.people.sort(
        (a, b) =>
          a.rosterOrder - b.rosterOrder
          || (a.employeeId ?? Number.MAX_SAFE_INTEGER) - (b.employeeId ?? Number.MAX_SAFE_INTEGER),
      );
    }
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function buildTodayModel(
  date: string,
  schedule: TeamSchedule,
  templates: readonly ScheduleTemplate[],
): TodayModel {
  const covering = schedule.shifts.filter((shift) => coversDate(shift, date));
  const timed = covering.filter((shift) => shift.start != null);
  const noTime = covering.filter((shift) => shift.start == null);
  const working = new Set(
    timed.flatMap((shift) => shift.employeeId == null ? [] : [shift.employeeId]),
  );
  const absent = new Set(
    noTime.flatMap(
      (shift) => isAbsence(shift.category) && shift.employeeId != null ? [shift.employeeId] : [],
    ),
  );
  return {
    groups: groupEntries(timed, schedule.employees, templates),
    noTimeGroups: groupEntries(noTime, schedule.employees, templates)
      .sort((a, b) => a.entries[0]!.shift.category.localeCompare(b.entries[0]!.shift.category)),
    workingCount: working.size,
    absentCount: absent.size,
  };
}

function weekCell(
  date: string,
  employeeId: number | null,
  shifts: readonly Shift[],
  templates: readonly ScheduleTemplate[],
): WeekCell {
  const entries = shifts
    .filter((shift) => shift.employeeId === employeeId && coversDate(shift, date))
    .sort((a, b) => compareShifts(a, b, templates))
    .map((shift) => toEntryView(shift, templates));
  return {
    date,
    entries,
    primary: entries[0] ?? null,
    extraCount: Math.max(0, entries.length - 1),
  };
}

export function buildWeekModel(
  mondayIso: string,
  schedule: TeamSchedule,
  templates: readonly ScheduleTemplate[],
): WeekModel {
  const monday = new Date(`${mondayIso}T12:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => toISODate(addDays(monday, index)));
  const employees = [...schedule.employees].sort((a, b) => {
    const aOrder = a.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.id - b.id;
  });
  const rows: WeekRow[] = employees.map((employee) => ({
    employeeId: employee.id,
    displayName: employee.displayName,
    cells: days.map((date) => weekCell(date, employee.id, schedule.shifts, templates)),
  }));
  if (
    schedule.shifts.some(
      (shift) => shift.employeeId == null && days.some((date) => coversDate(shift, date)),
    )
  ) {
    rows.push({
      employeeId: null,
      displayName: "Не назначено",
      cells: days.map((date) => weekCell(date, null, schedule.shifts, templates)),
    });
  }
  return { days, rows };
}

export interface LatestRequestGate {
  begin(): number;
  isLatest(id: number): boolean;
}

export function createLatestRequestGate(): LatestRequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (id) => id === latest,
  };
}

export type TeamLoadResult =
  | { status: "accepted"; schedule: TeamSchedule }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export async function requestLatestTeamSchedule(
  load: (from: string, to: string) => Promise<TeamSchedule>,
  range: TeamRange,
  gate: LatestRequestGate,
): Promise<TeamLoadResult> {
  const id = gate.begin();
  try {
    const schedule = await load(range.from, range.to);
    return gate.isLatest(id) ? { status: "accepted", schedule } : { status: "stale" };
  } catch (error) {
    return gate.isLatest(id) ? { status: "failed", error } : { status: "stale" };
  }
}
