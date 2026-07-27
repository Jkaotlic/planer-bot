import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Shift, TeamSchedule } from "../../api/client";
import {
  buildTodayModel,
  buildWeekModel,
  type TeamEntryView,
  type TodayModel,
  type WeekCell,
} from "../../lib/team-schedule";
import { TeamRangeNav } from "./TeamRangeNav";
import { toTeamEntryDetailRows } from "./TeamEntryDetails";
import { TeamTodayView } from "./TeamTodayView";
import {
  teamModeForArrowKey,
  TeamViewPanel,
  TeamViewSwitcher,
} from "./TeamViewSwitcher";
import { selectWeekCellDetails, TeamWeekGrid } from "./TeamWeekGrid";

describe("team schedule UI", () => {
  it("renders Today and Week as labelled tabs with the current tab selected", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "section",
        null,
        createElement(TeamViewSwitcher, {
          value: "today",
          onChange: () => undefined,
        }),
        createElement(
          TeamViewPanel,
          { mode: "today" },
          createElement("span", null, "Содержимое дня"),
        ),
      ),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Вид расписания"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain(
      'role="tab" id="team-view-tab-today" aria-selected="true" aria-controls="team-view-panel-today" tabindex="0"',
    );
    expect(markup).toContain(
      'role="tab" id="team-view-tab-week" aria-selected="false" aria-controls="team-view-panel-week" tabindex="-1"',
    );
    expect(markup).toContain(
      'role="tabpanel" id="team-view-panel-today" aria-labelledby="team-view-tab-today"',
    );
    expect(markup).toContain(">Сегодня<");
    expect(markup).toContain(">Неделя<");
  });

  it("wraps roving tab focus through Today and Week with horizontal arrows", () => {
    expect(teamModeForArrowKey("today", "ArrowRight")).toBe("week");
    expect(teamModeForArrowKey("week", "ArrowRight")).toBe("today");
    expect(teamModeForArrowKey("today", "ArrowLeft")).toBe("week");
    expect(teamModeForArrowKey("week", "ArrowLeft")).toBe("today");
    expect(teamModeForArrowKey("today", "Enter")).toBeNull();
  });

  it("renders the range label live and disables both navigation buttons while busy", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "Вт, 28 июля",
        busy: true,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="Предыдущий период"');
    expect(markup).toContain('aria-label="Следующий период"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('<strong aria-live="polite">Вт, 28 июля</strong>');
  });

  it("renders Today totals, chronological groups, full names, and no-time entries", () => {
    const timedShift = (
      id: number,
      employeeId: number,
      start: string,
      end: string,
      templateId: number,
    ): Shift => ({
      id,
      date: "2026-07-28",
      start,
      end,
      endDate: null,
      category: "shift",
      title: null,
      location: null,
      templateId,
      employeeId,
    });
    const schedule: TeamSchedule = {
      employees: [
        { id: 20, displayName: "Шилов Дмитрий Сергеевич", rosterOrder: 0 },
        { id: 10, displayName: "Юдин Максим", rosterOrder: 1 },
      ],
      shifts: [
        timedShift(2, 10, "09:00", "18:00", 2),
        timedShift(1, 20, "07:00", "16:00", 6),
        {
          id: 3,
          date: "2026-07-28",
          start: null,
          end: null,
          endDate: null,
          category: "vacation",
          title: null,
          location: null,
          templateId: null,
          employeeId: 10,
        },
      ],
    };
    const model = buildTodayModel("2026-07-28", schedule, [
      { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
      { id: 2, name: "День", accent: "blue", sortOrder: 1 },
    ]);

    const markup = renderToStaticMarkup(createElement(TeamTodayView, { model }));

    expect(markup).toContain('aria-label="Итоги дня"');
    expect(markup).toContain("<b>2</b> На работе");
    expect(markup).toContain("<b>1</b> Отсутствует");
    expect(markup).toContain("Дежурство с 07:00");
    expect(markup.indexOf("Дежурство с 07:00")).toBeLessThan(markup.indexOf(">День<"));
    expect(markup).toContain("07:00–16:00");
    expect(markup).toContain("Шилов Дмитрий Сергеевич");
    expect(markup).toContain('class="team-group__marker" style="background:#CBC04D"');
    expect(markup).toContain("<h3>Без времени</h3>");
    expect(markup).toContain("Отпуск");
    expect(markup).toContain("Весь день");
    expect(markup).toContain("Юдин Максим");
  });

  it("renders the Today empty guidance while preserving zero totals", () => {
    const model: TodayModel = {
      workingCount: 0,
      absentCount: 0,
      groups: [],
      noTimeGroups: [],
    };

    const markup = renderToStaticMarkup(createElement(TeamTodayView, { model }));

    expect(markup).toContain("<b>0</b> На работе");
    expect(markup).toContain("<b>0</b> Отсутствует");
    expect(markup).toContain("На этот день записей нет");
    expect(markup).toContain("Выберите соседнюю дату стрелками.");
    expect(markup).not.toContain('class="team-today"');
  });

  it("renders all seven dates, active rows, two-line names, exact palettes, and full cell labels", () => {
    const schedule: TeamSchedule = {
      employees: [
        { id: 20, displayName: "Шилов Дмитрий", rosterOrder: 0 },
        { id: 10, displayName: "Юдин Максим", rosterOrder: 1 },
        { id: 30, displayName: "Без Смены", rosterOrder: 2 },
      ],
      shifts: [
        {
          id: 1,
          date: "2026-07-27",
          start: "07:00",
          end: "16:00",
          endDate: null,
          category: "duty",
          title: null,
          location: null,
          templateId: 6,
          employeeId: 20,
        },
        {
          id: 2,
          date: "2026-07-27",
          start: "09:00",
          end: "18:00",
          endDate: null,
          category: "shift",
          title: null,
          location: null,
          templateId: 2,
          employeeId: 20,
        },
        {
          id: 3,
          date: "2026-07-27",
          start: "08:00",
          end: "17:00",
          endDate: null,
          category: "shift",
          title: null,
          location: null,
          templateId: 1,
          employeeId: 10,
        },
        {
          id: 4,
          date: "2026-07-27",
          start: null,
          end: null,
          endDate: "2026-07-29",
          category: "vacation",
          title: null,
          location: null,
          templateId: null,
          employeeId: 10,
        },
        {
          id: 5,
          date: "2026-07-27",
          start: "09:00",
          end: "18:00",
          endDate: null,
          category: "shift",
          title: "Открытая смена",
          location: null,
          templateId: null,
          employeeId: null,
        },
      ],
    };
    const templates = [
      { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
      { id: 1, name: "Утро", accent: "gold", sortOrder: 1 },
      { id: 2, name: "День", accent: "blue", sortOrder: 2 },
    ] as const;
    const model = buildWeekModel("2026-07-27", schedule, templates);

    const markup = renderToStaticMarkup(
      createElement(TeamWeekGrid, { model, today: "2026-07-30" }),
    );

    expect(markup.match(/class="team-week__day/g)).toHaveLength(7);
    expect([...markup.matchAll(/data-date="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(markup.match(/class="team-week__row"/g)).toHaveLength(4);
    expect(markup).toContain(
      '<div class="team-week__name"><b>Шилов</b><span>Дмитрий</span></div>',
    );
    expect(markup).toContain(
      '<div class="team-week__name"><b>Без</b><span>Смены</span></div>',
    );
    expect(markup).toContain(
      '<div class="team-week__name"><b>Не</b><span>назначено</span></div>',
    );
    expect(markup).toContain(
      'style="background:#CBC04D;color:#292505"',
    );
    expect(markup).toContain(
      'style="background:#FD0100;color:#FFFFFF"',
    );
    expect(markup).toContain(">07<");
    expect(markup).toContain(">О<");
    expect(markup).toContain("<small>+1</small>");
    expect(markup).toContain(
      'aria-label="2026-07-27: Дежурство с 07:00, День"',
    );
    expect(markup).toContain(
      'class="team-week__day is-today" data-date="2026-07-30"',
    );
    expect(markup).toContain(
      'class="team-week__day is-weekend" data-date="2026-08-01"',
    );
    expect(markup).toContain(
      'class="team-week__cell is-weekend" aria-label="2026-08-02: нет записи"',
    );

    const withoutUnassigned = renderToStaticMarkup(
      createElement(TeamWeekGrid, {
        model: buildWeekModel(
          "2026-07-27",
          {
            ...schedule,
            shifts: schedule.shifts.filter((entry) => entry.employeeId != null),
          },
          templates,
        ),
        today: "2026-07-30",
      }),
    );
    expect(withoutUnassigned.match(/class="team-week__row"/g)).toHaveLength(3);
    expect(withoutUnassigned).not.toContain("Не назначено");
    expect(withoutUnassigned).toContain(
      '<div class="team-week__name"><b>Без</b><span>Смены</span></div>',
    );
  });

  it("selects every entry in a populated cell and preserves complete detail fields", () => {
    const entries: TeamEntryView[] = [
      {
        shift: {
          id: 90,
          date: "2026-07-30",
          start: "10:00",
          end: "12:30",
          endDate: "2026-08-01",
          category: "offsite",
          title: "Сокращённое название",
          location: "Клиентский офис",
          templateId: null,
          employeeId: 20,
        },
        title: "Полное название выездной встречи",
        palette: null,
      },
      {
        shift: {
          id: 91,
          date: "2026-07-30",
          start: null,
          end: null,
          endDate: null,
          category: "vacation",
          title: null,
          location: null,
          templateId: null,
          employeeId: 20,
        },
        title: "Отпуск",
        palette: null,
      },
    ];
    const cell: WeekCell = {
      date: "2026-07-30",
      entries,
      primary: entries[0]!,
      extraCount: 1,
    };

    expect(selectWeekCellDetails(cell)).toEqual(entries);
    expect(
      toTeamEntryDetailRows(selectWeekCellDetails(cell)),
    ).toEqual([
      {
        id: 90,
        title: "Полное название выездной встречи",
        time: "10:00–12:30",
        location: "Место: Клиентский офис",
        dateRange: "2026-07-30 — 2026-08-01",
      },
      {
        id: 91,
        title: "Отпуск",
        time: "Весь день",
        location: null,
        dateRange: "2026-07-30",
      },
    ]);
    expect(
      selectWeekCellDetails({
        date: "2026-07-31",
        entries: [],
        primary: null,
        extraCount: 0,
      }),
    ).toEqual([]);
  });
});
