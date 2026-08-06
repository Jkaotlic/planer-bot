import { describe, expect, it } from "vitest";
import type { Shift, TeamSchedule, Template } from "../api/client";
import {
  applyTeamScreenLoadResult,
  beginTeamScreenLoad,
  buildTodayModel,
  buildWeekLegend,
  buildWeekModel,
  createLatestRequestGate,
  createTeamScreenState,
  moveTeamDate,
  requestLatestTeamSchedule,
  splitDisplayName,
  teamModeLoadTarget,
  teamRange,
  teamTabFocusMode,
  teamVisibilityRefreshTarget,
} from "./team-schedule";

const templates = [
  { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
  { id: 1, name: "Утро", accent: "gold", sortOrder: 1 },
  { id: 2, name: "День", accent: "blue", sortOrder: 2 },
] as const satisfies ReadonlyArray<Pick<Template, "id" | "name" | "accent" | "sortOrder">>;

const employees = [
  { id: 20, displayName: "Орлов Дмитрий", rosterOrder: 0 },
  { id: 10, displayName: "Соколов Максим", rosterOrder: 1 },
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

const nextSchedule: TeamSchedule = {
  employees,
  shifts: [
    shift({
      id: 20,
      date: "2026-07-28",
      start: "10:00",
      end: "19:00",
      employeeId: 30,
    }),
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
    expect(model.groups.map((group) => group.palette?.code)).toEqual(["07", "У", "Д"]);
    expect(model.noTimeGroups.map((group) => group.title)).toEqual(["Отпуск"]);
    expect(model.noTimeGroups.map((group) => group.palette?.code)).toEqual(["О"]);
    expect(model.workingCount).toBe(2);
    expect(model.absentCount).toBe(1);
    expect(model.groups[2]?.people.map((person) => person.displayName)).toEqual([
      "Орлов Дмитрий",
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
      "Орлов Дмитрий",
      "Соколов Максим",
      "Без Смены",
      "Не назначено",
    ]);
    expect(model.rows[2]?.cells.every((cell) => cell.entries.length === 0)).toBe(true);
    expect(model.rows[0]?.cells[0]?.entries).toHaveLength(2);
    expect(model.rows[0]?.cells[0]?.entries.map((entry) => entry.shift.id)).toEqual([2, 5]);
    expect(model.rows[0]?.cells[0]?.primary?.shift.id).toBe(2);
    expect(model.rows[0]?.cells[0]?.extraCount).toBe(1);
    expect(model.rows[0]?.cells[0]?.primary?.palette).toEqual({
      bg: "#CBC04D",
      fg: "#292505",
      code: "07",
    });
    expect(
      model.rows[1]?.cells
        .slice(0, 3)
        .every((cell) => cell.entries.some((entry) => entry.shift.category === "vacation")),
    ).toBe(true);
    expect(
      model.rows[1]?.cells[0]?.entries
        .find((entry) => entry.shift.category === "vacation")
        ?.palette,
    ).toEqual({
      bg: "#FD0100",
      fg: "#FFFFFF",
      code: "О",
    });
  });

  it("splits surname from the remaining name and calculates exact ranges", () => {
    expect(splitDisplayName("Соколов Максим Сергеевич")).toEqual({
      surname: "Соколов",
      rest: "Максим Сергеевич",
    });
    expect(teamRange("today", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-08-01" });
    expect(teamRange("week", "2026-08-01")).toEqual({ from: "2026-07-27", to: "2026-08-02" });
  });

  it("moves Today by one day and Week by exactly seven days", () => {
    expect(moveTeamDate("today", "2026-07-31", 1)).toBe("2026-08-01");
    expect(moveTeamDate("today", "2026-07-31", -1)).toBe("2026-07-30");
    expect(moveTeamDate("week", "2026-07-31", 1)).toBe("2026-08-07");
    expect(moveTeamDate("week", "2026-07-31", -1)).toBe("2026-07-24");
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

  it("keeps committed mode, date, range, and schedule paired until the pending view is accepted", () => {
    let state = createTeamScreenState("2026-07-27");
    expect(state).toMatchObject({
      displayMode: "today",
      displayDate: "2026-07-27",
      targetMode: "today",
      targetDate: "2026-07-27",
    });
    state = beginTeamScreenLoad(state, "today", "2026-07-27");
    state = applyTeamScreenLoadResult(
      state,
      "today",
      "2026-07-27",
      { status: "accepted", schedule },
    )!;

    const pending = beginTeamScreenLoad(state, "week", "2026-08-01");

    expect(pending).toMatchObject({
      displayMode: "today",
      displayDate: "2026-07-27",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule,
      loading: true,
      error: null,
    });
    expect(teamRange(pending.displayMode, pending.displayDate)).toEqual({
      from: "2026-07-27",
      to: "2026-07-27",
    });
    expect(teamRange(pending.targetMode, pending.targetDate)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });

    const accepted = applyTeamScreenLoadResult(
      pending,
      "week",
      "2026-08-01",
      { status: "accepted", schedule: nextSchedule },
    );
    expect(accepted).toMatchObject({
      displayMode: "week",
      displayDate: "2026-08-01",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule: nextSchedule,
      loading: false,
      error: null,
    });
    expect(teamRange(accepted!.displayMode, accepted!.displayDate)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });
  });

  it("retains the committed view and failed mode/range target through retry", () => {
    let state = createTeamScreenState("2026-07-27");
    state = beginTeamScreenLoad(state, "today", "2026-07-27");
    state = applyTeamScreenLoadResult(
      state,
      "today",
      "2026-07-27",
      { status: "accepted", schedule },
    )!;
    state = beginTeamScreenLoad(state, "week", "2026-08-01");

    const failed = applyTeamScreenLoadResult(
      state,
      "week",
      "2026-08-01",
      { status: "failed", error: new Error("offline") },
    )!;
    expect(failed).toMatchObject({
      displayMode: "today",
      displayDate: "2026-07-27",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule,
      loading: false,
      error: "offline",
    });

    const retrying = beginTeamScreenLoad(
      failed,
      failed.targetMode,
      failed.targetDate,
    );
    expect(retrying).toMatchObject({
      displayMode: "today",
      displayDate: "2026-07-27",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule,
      loading: true,
      error: null,
    });

    const recovered = applyTeamScreenLoadResult(
      retrying,
      retrying.targetMode,
      retrying.targetDate,
      { status: "accepted", schedule: nextSchedule },
    );
    expect(recovered).toMatchObject({
      displayMode: "week",
      displayDate: "2026-08-01",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule: nextSchedule,
      loading: false,
      error: null,
    });
  });

  it("refreshes the failed target after returning to the foreground", () => {
    let state = createTeamScreenState("2026-07-27");
    state = beginTeamScreenLoad(state, "today", "2026-07-27");
    state = applyTeamScreenLoadResult(
      state,
      "today",
      "2026-07-27",
      { status: "accepted", schedule },
    )!;
    state = beginTeamScreenLoad(state, "week", "2026-08-01");
    state = applyTeamScreenLoadResult(
      state,
      "week",
      "2026-08-01",
      { status: "failed", error: new Error("offline") },
    )!;

    const refreshTarget = teamVisibilityRefreshTarget(state);
    expect(refreshTarget).toEqual({ mode: "week", date: "2026-08-01" });

    state = beginTeamScreenLoad(
      state,
      refreshTarget!.mode,
      refreshTarget!.date,
    );
    expect(teamVisibilityRefreshTarget(state)).toBeNull();

    state = applyTeamScreenLoadResult(
      state,
      refreshTarget!.mode,
      refreshTarget!.date,
      { status: "accepted", schedule: nextSchedule },
    )!;
    expect(state).toMatchObject({
      displayMode: "week",
      displayDate: "2026-08-01",
      targetMode: "week",
      targetDate: "2026-08-01",
      schedule: nextSchedule,
      loading: false,
      error: null,
    });
    expect(teamVisibilityRefreshTarget(state)).toEqual({
      mode: "week",
      date: "2026-08-01",
    });
  });

  it("controls the tab stop across pending, failure, retry, and completion", () => {
    let state = createTeamScreenState("2026-07-27");
    state = beginTeamScreenLoad(state, "today", "2026-07-27");
    state = applyTeamScreenLoadResult(
      state,
      "today",
      "2026-07-27",
      { status: "accepted", schedule },
    )!;
    expect(teamTabFocusMode(state, "week")).toBe("today");

    state = beginTeamScreenLoad(state, "week", "2026-07-27");
    expect(teamTabFocusMode(state, "week")).toBe("week");

    state = applyTeamScreenLoadResult(
      state,
      "week",
      "2026-07-27",
      { status: "failed", error: new Error("offline") },
    )!;
    expect(teamTabFocusMode(state, "week")).toBe("today");

    state = beginTeamScreenLoad(state, "week", "2026-07-27");
    expect(teamTabFocusMode(state, "today")).toBe("today");

    state = applyTeamScreenLoadResult(
      state,
      "week",
      "2026-07-27",
      { status: "accepted", schedule: nextSchedule },
    )!;
    expect(teamTabFocusMode(state, "today")).toBe("week");
  });

  it("preserves a pending navigation date when replacing its mode and uses the display date while idle", () => {
    const idle = createTeamScreenState("2026-07-27");
    expect(teamModeLoadTarget(idle, "week")).toEqual({
      mode: "week",
      date: "2026-07-27",
    });

    const pending = beginTeamScreenLoad(idle, "today", "2026-07-28");
    const weekTarget = teamModeLoadTarget(pending, "week");
    expect(weekTarget).toEqual({
      mode: "week",
      date: "2026-07-28",
    });
    expect(teamRange(weekTarget!.mode, weekTarget!.date)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });
  });

  it("lets a mode change supersede an in-flight target without stale completion clearing it", async () => {
    let state = createTeamScreenState("2026-07-27");
    state = beginTeamScreenLoad(state, "today", "2026-07-27");
    state = applyTeamScreenLoadResult(
      state,
      "today",
      "2026-07-27",
      { status: "accepted", schedule },
    )!;

    const gate = createLatestRequestGate();
    let resolveWeek!: (value: TeamSchedule) => void;
    const weekPayload = new Promise<TeamSchedule>((resolve) => {
      resolveWeek = resolve;
    });
    const weekTarget = teamModeLoadTarget(state, "week");
    expect(weekTarget).toEqual({ mode: "week", date: "2026-07-27" });
    state = beginTeamScreenLoad(state, weekTarget!.mode, weekTarget!.date);
    const weekRequest = requestLatestTeamSchedule(
      () => weekPayload,
      teamRange(weekTarget!.mode, weekTarget!.date),
      gate,
    );

    expect(teamModeLoadTarget(state, "week")).toBeNull();
    const todayTarget = teamModeLoadTarget(state, "today");
    expect(todayTarget).toEqual({ mode: "today", date: "2026-07-27" });
    state = beginTeamScreenLoad(state, todayTarget!.mode, todayTarget!.date);

    let resolveToday!: (value: TeamSchedule) => void;
    const todayPayload = new Promise<TeamSchedule>((resolve) => {
      resolveToday = resolve;
    });
    const todayRequest = requestLatestTeamSchedule(
      () => todayPayload,
      teamRange(todayTarget!.mode, todayTarget!.date),
      gate,
    );

    resolveWeek(schedule);
    const staleWeek = await weekRequest;
    expect(staleWeek.status).toBe("stale");
    expect(
      applyTeamScreenLoadResult(
        state,
        weekTarget!.mode,
        weekTarget!.date,
        staleWeek,
      ),
    ).toBeNull();
    expect(state).toMatchObject({
      displayMode: "today",
      targetMode: "today",
      schedule,
      loading: true,
    });

    resolveToday(nextSchedule);
    const acceptedToday = await todayRequest;
    state = applyTeamScreenLoadResult(
      state,
      todayTarget!.mode,
      todayTarget!.date,
      acceptedToday,
    )!;
    expect(state).toMatchObject({
      displayMode: "today",
      targetMode: "today",
      schedule: nextSchedule,
      loading: false,
      error: null,
    });
  });

  it("returns no state transition for stale completion", () => {
    const state = beginTeamScreenLoad(
      createTeamScreenState("2026-07-27"),
      "week",
      "2026-08-01",
    );

    expect(
      applyTeamScreenLoadResult(
        state,
        "week",
        "2026-08-01",
        { status: "stale", outcome: "accepted", schedule: nextSchedule },
      ),
    ).toBeNull();
  });

  it("rejects a completion whose mode differs from the current pending target", () => {
    const state = beginTeamScreenLoad(
      createTeamScreenState("2026-07-27"),
      "week",
      "2026-07-27",
    );

    expect(
      applyTeamScreenLoadResult(
        state,
        "today",
        "2026-07-27",
        { status: "accepted", schedule: nextSchedule },
      ),
    ).toBeNull();
  });

  it("invalidates an in-flight request when the screen lifetime ends", async () => {
    const gate = createLatestRequestGate();
    let resolve!: (value: TeamSchedule) => void;
    const pending = requestLatestTeamSchedule(
      () => new Promise<TeamSchedule>((done) => { resolve = done; }),
      { from: "2026-07-27", to: "2026-07-27" },
      gate,
    );

    gate.invalidate();
    resolve(schedule);

    expect(await pending).toEqual({
      status: "stale",
      outcome: "accepted",
      schedule,
    });
  });
});

describe("buildWeekLegend", () => {
  const MONDAY = "2026-07-27";

  /** A schedule with one entry per person, so every cell's primary is that entry. */
  const scheduleOf = (shifts: Shift[]): TeamSchedule => ({
    employees: [...new Set(shifts.map((s) => s.employeeId))].map((id, index) => ({
      id: id as number,
      displayName: `Человек ${index + 1}`,
      rosterOrder: index,
    })),
    shifts,
  });

  const shift = (over: Partial<Shift> & Pick<Shift, "id" | "employeeId" | "date">): Shift => ({
    start: "09:00", end: "18:00", endDate: null, category: "shift",
    title: "День", templateId: 2, location: null, ...over,
  } as Shift);

  it("names every letter the grid drew, and nothing else", () => {
    const model = buildWeekModel(MONDAY, scheduleOf([
      shift({ id: 1, employeeId: 1, date: MONDAY }),
      shift({ id: 2, employeeId: 2, date: MONDAY, templateId: 1, title: "Утро", start: "08:00", end: "17:00" }),
    ]), templates);

    const legend = buildWeekLegend(model);
    // Ordered by label, ru-collated: «День» before «Утро».
    expect(legend.map((i) => `${i.code}=${i.label}`)).toEqual(["Д=День", "У=Утро"]);
    // Presets nobody worked this week must not appear.
    expect(legend.some((i) => i.label === "Ночь")).toBe(false);
  });

  it("carries the same colours the cells use", () => {
    const model = buildWeekModel(MONDAY, scheduleOf([shift({ id: 1, employeeId: 1, date: MONDAY })]), templates);
    const [item] = buildWeekLegend(model);
    const cell = model.rows[0]!.cells[0]!;
    expect(item!.palette).toEqual(cell.primary!.palette);
  });

  it("lists a letter once however many people worked it", () => {
    const model = buildWeekModel(MONDAY, scheduleOf([
      shift({ id: 1, employeeId: 1, date: MONDAY }),
      shift({ id: 2, employeeId: 2, date: MONDAY }),
      shift({ id: 3, employeeId: 3, date: "2026-07-28" }),
    ]), templates);
    expect(buildWeekLegend(model)).toHaveLength(1);
  });

  // Ветка «•» и порядок сортировки легенды переехали в `shared/src/week-model.test.ts`,
  // к самой функции: они про shared, а не про мини-апп, и держаться на здешнем
  // реэкспорте им незачем.

  it("is empty for a week with nothing in it", () => {
    expect(buildWeekLegend(buildWeekModel(MONDAY, scheduleOf([]), templates))).toEqual([]);
  });
});
