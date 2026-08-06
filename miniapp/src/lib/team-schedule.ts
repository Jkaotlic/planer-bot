import {
  buildWeekLegend,
  buildWeekModel,
  compareShifts,
  coversDate,
  isAbsence,
  splitDisplayName,
  toEntryView,
  type SchedulePalette,
  type SchedulePresetLike,
  type TeamEntryView as SharedTeamEntryView,
  type WeekCell as SharedWeekCell,
  type WeekLegendItem,
  type WeekModel as SharedWeekModel,
  type WeekRow as SharedWeekRow,
} from "@planer/shared";
import type { Shift, TeamEmployee, TeamSchedule } from "../api/client";
import { addDays, mondayOf, toISODate } from "./week";
import { createLatestRequestGate, type LatestRequestGate } from "./request-gate";

// Re-exported so existing importers (and this file's own tests) keep working
// unchanged — the gate itself now lives in `request-gate.ts` so other screens
// (e.g. `AdminScheduleScreen`) can reuse it without importing team-specific code.
export { createLatestRequestGate };
export type { LatestRequestGate };

// Сетка недели переехала в @planer/shared: ею же сервер рисует картинку для
// бота. Здесь остаются только псевдонимы под конкретный `Shift` мини-аппа,
// чтобы компоненты не переписывать.
//
// Наружу отдаётся только то, что снаружи и зовут. `toEntryView` и
// `compareShifts` до переезда были приватными и нужны по-прежнему лишь внутри
// этого файла — импорт выше их и даёт.
export { buildWeekLegend, buildWeekModel, coversDate, splitDisplayName };
export type { WeekLegendItem };
export type TeamEntryView = SharedTeamEntryView<Shift>;
export type WeekCell = SharedWeekCell<Shift>;
export type WeekRow = SharedWeekRow<Shift>;
export type WeekModel = SharedWeekModel<Shift>;

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

type ScheduleTemplate = SchedulePresetLike;

export function teamRange(mode: TeamMode, selectedDate: string): TeamRange {
  if (mode === "today") return { from: selectedDate, to: selectedDate };
  const monday = mondayOf(new Date(`${selectedDate}T12:00:00`));
  return { from: toISODate(monday), to: toISODate(addDays(monday, 6)) };
}

export function moveTeamDate(
  mode: TeamMode,
  selectedDate: string,
  direction: -1 | 1,
): string {
  const step = mode === "today" ? direction : direction * 7;
  return toISODate(addDays(new Date(`${selectedDate}T12:00:00`), step));
}

function groupingKey(shift: Shift): string {
  if (shift.templateId != null) return `template:${shift.templateId}`;
  return JSON.stringify([
    "custom",
    shift.category,
    shift.title,
    shift.start,
    shift.end,
    shift.location,
  ]);
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

export type TeamLoadResult =
  | { status: "accepted"; schedule: TeamSchedule }
  | { status: "failed"; error: unknown }
  | { status: "stale"; outcome: "accepted"; schedule: TeamSchedule }
  | { status: "stale"; outcome: "failed"; error: unknown };

export interface TeamScreenState {
  displayMode: TeamMode;
  displayDate: string;
  targetMode: TeamMode;
  targetDate: string;
  schedule: TeamSchedule | null;
  loading: boolean;
  error: string | null;
}

export interface TeamModeLoadTarget {
  mode: TeamMode;
  date: string;
}

export function teamModeLoadTarget(
  state: TeamScreenState,
  requestedMode: TeamMode,
): TeamModeLoadTarget | null {
  const activeMode = state.loading ? state.targetMode : state.displayMode;
  const activeDate = state.loading ? state.targetDate : state.displayDate;
  return requestedMode === activeMode
    ? null
    : { mode: requestedMode, date: activeDate };
}

export function teamTabFocusMode(
  state: TeamScreenState,
  pendingFocusMode: TeamMode,
): TeamMode {
  return state.loading ? pendingFocusMode : state.displayMode;
}

export function teamVisibilityRefreshTarget(
  state: TeamScreenState,
): TeamModeLoadTarget | null {
  if (state.loading) return null;
  return state.error
    ? { mode: state.targetMode, date: state.targetDate }
    : { mode: state.displayMode, date: state.displayDate };
}

export function createTeamScreenState(date: string): TeamScreenState {
  return {
    displayMode: "today",
    displayDate: date,
    targetMode: "today",
    targetDate: date,
    schedule: null,
    loading: false,
    error: null,
  };
}

export function beginTeamScreenLoad(
  state: TeamScreenState,
  targetMode: TeamMode,
  targetDate: string,
): TeamScreenState {
  return {
    ...state,
    targetMode,
    targetDate,
    loading: true,
    error: null,
  };
}

export function applyTeamScreenLoadResult(
  state: TeamScreenState,
  targetMode: TeamMode,
  targetDate: string,
  result: TeamLoadResult,
): TeamScreenState | null {
  if (
    result.status === "stale"
    || state.targetMode !== targetMode
    || state.targetDate !== targetDate
  ) {
    return null;
  }
  if (result.status === "failed") {
    return {
      ...state,
      loading: false,
      error:
        result.error instanceof Error
          ? result.error.message
          : "Не удалось загрузить расписание",
    };
  }
  return {
    displayMode: targetMode,
    displayDate: targetDate,
    targetMode,
    targetDate,
    schedule: result.schedule,
    loading: false,
    error: null,
  };
}

export async function requestLatestTeamSchedule(
  load: (from: string, to: string) => Promise<TeamSchedule>,
  range: TeamRange,
  gate: LatestRequestGate,
): Promise<TeamLoadResult> {
  const id = gate.begin();
  try {
    const schedule = await load(range.from, range.to);
    return gate.isLatest(id)
      ? { status: "accepted", schedule }
      : { status: "stale", outcome: "accepted", schedule };
  } catch (error) {
    return gate.isLatest(id)
      ? { status: "failed", error }
      : { status: "stale", outcome: "failed", error };
  }
}
