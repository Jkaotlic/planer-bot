import { describe, expect, it } from "vitest";
import type { Shift, TeamSchedule, Template } from "../api/client";
import {
  buildTodayModel,
  buildWeekModel,
  createLatestRequestGate,
  requestLatestTeamSchedule,
  splitDisplayName,
  teamRange,
} from "./team-schedule";

const templates = [
  { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
  { id: 1, name: "Утро", accent: "gold", sortOrder: 1 },
  { id: 2, name: "День", accent: "blue", sortOrder: 2 },
] as const satisfies ReadonlyArray<Pick<Template, "id" | "name" | "accent" | "sortOrder">>;

const employees = [
  { id: 20, displayName: "Шилов Дмитрий", rosterOrder: 0 },
  { id: 10, displayName: "Юдин Максим", rosterOrder: 1 },
  { id: 30, displayName: "Без Смены", rosterOrder: 2 },
];

function shift(patch: Partial<Shift> & Pick<Shift, "id" | "date" | "employeeId">): Shift {
  return {
    start: "09:00",
    end: "18:00",
    endDate: null,
    category: "shift",
    title: "День",
    templateId: 2,
    location: null,
    ...patch,
  };
}

const schedule: TeamSchedule = {
  employees,
  shifts: [
    shift({ id: 1, date: "2026-07-27", start: "08:00", end: "17:00", title: "Утро", templateId: 1, employeeId: 10 }),
    shift({ id: 2, date: "2026-07-27", start: "07:00", end: "16:00", title: "Дежурство с 07:00", templateId: 6, category: "duty", employeeId: 20 }),
    shift({ id: 3, date: "2026-07-26", endDate: "2026-07-29", start: null, end: null, title: null, templateId: null, category: "vacation", employeeId: 10 }),
    shift({ id: 4, date: "2026-07-27", employeeId: null }),
    shift({ id: 5, date: "2026-07-27", start: "09:00", end: "18:00", employeeId: 20 }),
  ],
};

describe("team schedule model", () => {
  it("builds chronological today groups with no-time entries last", () => {
    const model = buildTodayModel("2026-07-27", schedule, templates);
    expect(model.groups.map((group) => group.title)).toEqual([
      "Дежурство с 07:00",
      "Утро",
      "День",
    ]);
    expect(model.groups.map((group) => group.palette?.code)).toEqual(["07", "У", "С"]);
    expect(model.noTimeGroups.map((group) => group.title)).toEqual(["Отпуск"]);
    expect(model.noTimeGroups.map((group) => group.palette?.code)).toEqual(["О"]);
    expect(model.workingCount).toBe(2);
    expect(model.absentCount).toBe(1);
    expect(model.groups[2]?.people.map((person) => person.displayName)).toEqual([
      "Шилов Дмитрий",
      "Не назначено",
    ]);
  });

  it("keeps custom groups separate when exact tuples share a colon-joined representation", () => {
    const collisionSchedule: TeamSchedule = {
      employees,
      shifts: [
        shift({
          id: 6,
          date: "2026-07-27",
          title: "Встреча",
          start: "09:10",
          end: "18:20",
          location: "30:Офис",
          templateId: null,
          category: "duty",
          employeeId: 20,
        }),
        shift({
          id: 7,
          date: "2026-07-27",
          title: "Встреча:09",
          start: "10:18",
          end: "20:30",
          location: "Офис",
          templateId: null,
          category: "duty",
          employeeId: 10,
        }),
      ],
    };

    const model = buildTodayModel("2026-07-27", collisionSchedule, templates);

    expect(model.groups.map((group) => group.title)).toEqual(["Встреча", "Встреча:09"]);
    expect(model.groups.map((group) => group.entries.map((entry) => entry.shift.id))).toEqual([[6], [7]]);
  });

  it("keeps roster order, every employee row, seven days, unassigned work, and +N details", () => {
    const model = buildWeekModel(
      "2026-07-27",
      { ...schedule, employees: [...schedule.employees].reverse() },
      templates,
    );
    expect(model.days).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(model.rows.map((row) => row.displayName)).toEqual([
      "Шилов Дмитрий",
      "Юдин Максим",
      "Без Смены",
      "Не назначено",
    ]);
    expect(model.rows[2]?.cells.every((cell) => cell.entries.length === 0)).toBe(true);
    expect(model.rows[0]?.cells[0]?.entries).toHaveLength(2);
    expect(model.rows[0]?.cells[0]?.extraCount).toBe(1);
    expect(
      model.rows[1]?.cells
        .slice(0, 3)
        .every((cell) => cell.entries.some((entry) => entry.shift.category === "vacation")),
    ).toBe(true);
  });

  it("splits surname from the remaining name and calculates exact ranges", () => {
    expect(splitDisplayName("Юдин Максим Сергеевич")).toEqual({
      surname: "Юдин",
      rest: "Максим Сергеевич",
    });
    expect(teamRange("today", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-08-01" });
    expect(teamRange("week", "2026-08-01")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("moves Today by one day and Week by seven days through the existing date helpers", () => {
    expect(teamRange("today", "2026-07-28")).toEqual({
      from: "2026-07-28",
      to: "2026-07-28",
    });
    expect(teamRange("week", "2026-08-03")).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
  });

  it("distinguishes stale success from stale failure while both remain ignorable by status", async () => {
    const gate = createLatestRequestGate();
    let resolveOldSuccess!: (value: TeamSchedule) => void;
    const oldSuccessPromise = new Promise<TeamSchedule>((resolve) => { resolveOldSuccess = resolve; });
    const oldSuccessRequest = requestLatestTeamSchedule(
      () => oldSuccessPromise,
      { from: "2026-07-27", to: "2026-07-27" },
      gate,
    );
    const acceptedRequest = requestLatestTeamSchedule(
      async () => schedule,
      { from: "2026-07-28", to: "2026-07-28" },
      gate,
    );
    expect(await acceptedRequest).toEqual({ status: "accepted", schedule });
    resolveOldSuccess(schedule);
    const staleSuccess = await oldSuccessRequest;

    const staleError = new Error("late offline");
    let rejectOldFailure!: (error: Error) => void;
    const oldFailurePromise = new Promise<TeamSchedule>((_resolve, reject) => { rejectOldFailure = reject; });
    const oldFailureRequest = requestLatestTeamSchedule(
      () => oldFailurePromise,
      { from: "2026-07-29", to: "2026-07-29" },
      gate,
    );
    const finalAcceptedRequest = requestLatestTeamSchedule(
      async () => schedule,
      { from: "2026-07-30", to: "2026-07-30" },
      gate,
    );
    expect(await finalAcceptedRequest).toEqual({ status: "accepted", schedule });
    rejectOldFailure(staleError);
    const staleFailure = await oldFailureRequest;

    expect(staleSuccess).toEqual({ status: "stale", outcome: "accepted", schedule });
    expect(staleFailure).toEqual({ status: "stale", outcome: "failed", error: staleError });
    expect([staleSuccess.status, staleFailure.status]).toEqual(["stale", "stale"]);
  });

  it("surfaces an error only when the failing request is still current", async () => {
    const gate = createLatestRequestGate();
    const error = new Error("offline");
    const result = await requestLatestTeamSchedule(
      async () => { throw error; },
      { from: "2026-07-27", to: "2026-07-27" },
      gate,
    );
    expect(result).toEqual({ status: "failed", error });
  });
});
