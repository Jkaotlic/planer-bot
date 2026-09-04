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
  type WeekModel,
} from "../../lib/team-schedule";
import { TeamRangeNav } from "./TeamRangeNav";
import { toTeamEntryDetailRows } from "./TeamEntryDetails";
import { TeamTodayView } from "./TeamTodayView";
import {
  handleTeamViewSwitcherKeyDown,
  teamModeForArrowKey,
  TeamViewPanel,
  TeamViewSwitcher,
} from "./TeamViewSwitcher";
import { resolveWeekCellSelection, TeamWeekGrid } from "./TeamWeekGrid";
import { TeamWeekLegend } from "./TeamWeekLegend";

function fallbackPaletteSchedule(): TeamSchedule {
  const categories = [
    {
      id: 101,
      employeeId: 1,
      date: "2026-07-27",
      start: "07:00",
      end: "16:00",
      category: "duty",
      title: "Дежурство с 07:00",
      templateId: 6,
    },
    {
      id: 102,
      employeeId: 2,
      date: "2026-07-27",
      start: "09:00",
      end: "18:00",
      category: "duty",
      title: "Своя точка",
      templateId: null,
    },
    {
      id: 103,
      employeeId: 3,
      date: "2026-07-28",
      start: "10:00",
      end: "19:00",
      category: "offsite",
      title: "Выезд",
      templateId: null,
    },
    {
      id: 104,
      employeeId: 4,
      date: "2026-07-29",
      start: "11:00",
      end: "20:00",
      category: "weekend_work",
      title: null,
      templateId: null,
    },
    {
      id: 105,
      employeeId: 5,
      date: "2026-07-30",
      start: null,
      end: null,
      category: "sick_leave",
      title: null,
      templateId: null,
    },
    {
      id: 106,
      employeeId: 6,
      date: "2026-07-31",
      start: null,
      end: null,
      category: "business_trip",
      title: null,
      templateId: null,
    },
  ] as const;

  return {
    employees: categories.map((entry, index) => ({
      id: entry.employeeId,
      displayName: `Сотрудник ${index + 1}`,
      rosterOrder: index,
      excludedFromSwaps: false,
    })),
    shifts: categories.map((entry) => ({
      ...entry,
      endDate: null,
      location: null,
      unrecognisedCode: null,
    })),
  
    calendar: [],
  };
}

const fallbackPaletteTemplates = [
  {
    id: 6,
    name: "Дежурство с 07:00",
    accent: "amber",
    sortOrder: 0,
  },
] as const;

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

  it("runs the production arrow handler and never moves focus after a rejected change", () => {
    expect(teamModeForArrowKey("today", "ArrowRight")).toBe("week");
    expect(teamModeForArrowKey("week", "ArrowRight")).toBe("today");
    expect(teamModeForArrowKey("today", "ArrowLeft")).toBe("week");
    expect(teamModeForArrowKey("week", "ArrowLeft")).toBe("today");
    expect(teamModeForArrowKey("today", "Enter")).toBeNull();

    let prevented = 0;
    const changed: string[] = [];
    const focused: string[] = [];
    const event = {
      key: "ArrowRight",
      preventDefault: () => {
        prevented += 1;
      },
    };

    expect(
      handleTeamViewSwitcherKeyDown(
        event,
        "today",
        (mode) => {
          changed.push(mode);
          return true;
        },
        (mode) => focused.push(mode),
      ),
    ).toBe(true);
    expect({ prevented, changed, focused }).toEqual({
      prevented: 1,
      changed: ["week"],
      focused: ["week"],
    });

    event.key = "ArrowLeft";
    expect(
      handleTeamViewSwitcherKeyDown(
        event,
        "week",
        (mode) => {
          changed.push(mode);
          return false;
        },
        (mode) => focused.push(mode),
      ),
    ).toBe(true);
    expect({ prevented, changed, focused }).toEqual({
      prevented: 2,
      changed: ["week", "today"],
      focused: ["week"],
    });
  });

  it("keeps selected tab and roving tab stop independently controlled while pending", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamViewSwitcher, {
        value: "today",
        focusValue: "week",
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain(
      'id="team-view-tab-today" aria-selected="true" aria-controls="team-view-panel-today" tabindex="-1"',
    );
    expect(markup).toContain(
      'id="team-view-tab-week" aria-selected="false" aria-controls="team-view-panel-week" tabindex="0"',
    );
  });

  it("renders the range label live and disables both navigation buttons while busy", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "Вт, 28 июля",
        busy: true,
        backLabel: "Сегодня",
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="Предыдущий период"');
    expect(markup).toContain('aria-label="Следующий период"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('<strong aria-live="polite">Вт, 28 июля</strong>');
  });

  it("shows the back-to-today pill with the mode's own label when onBack is supplied", () => {
    const dayMarkup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "Чт, 30 июля",
        busy: false,
        backLabel: "Сегодня",
        onBack: () => undefined,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );
    expect(dayMarkup).toContain("↩ Сегодня");

    const weekMarkup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "28 июля – 3 авг",
        busy: false,
        backLabel: "Эта неделя",
        onBack: () => undefined,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );
    expect(weekMarkup).toContain("↩ Эта неделя");
  });

  it("renders no pill at all when onBack is omitted — the current period takes no extra space", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "Сегодня, Ср 29 июля",
        busy: false,
        backLabel: "Сегодня",
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );

    expect(markup).not.toContain("↩");
  });

  it("disables the pill along with the arrows while busy", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamRangeNav, {
        label: "Чт, 30 июля",
        busy: true,
        backLabel: "Эта неделя",
        onBack: () => undefined,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }),
    );

    expect(markup).toContain("↩ Эта неделя");
    // Two chevrons plus the pill, all sharing the same `busy` gate.
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
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
      unrecognisedCode: null,
      templateId,
      employeeId,
    });
    const schedule: TeamSchedule = {
      employees: [
        { id: 20, displayName: "Орлов Дмитрий Сергеевич", rosterOrder: 0, excludedFromSwaps: false },
        { id: 10, displayName: "Соколов Максим", rosterOrder: 1, excludedFromSwaps: false },
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
          unrecognisedCode: null,
          templateId: null,
          employeeId: 10,
        },
      ],
    
      calendar: [],
    };
    const model = buildTodayModel("2026-07-28", schedule, [
      { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
      { id: 2, name: "День", accent: "blue", sortOrder: 1 },
    ]);

    const markup = renderToStaticMarkup(
      createElement(TeamTodayView, { model, isDark: false }),
    );

    expect(markup).toContain('aria-label="Итоги дня"');
    expect(markup).toContain("<b>2</b> На работе");
    expect(markup).toContain("<b>1</b> Отсутствует");
    expect(markup).toContain("Дежурство с 07:00");
    expect(markup.indexOf("Дежурство с 07:00")).toBeLessThan(markup.indexOf(">День<"));
    expect(markup).toContain("07:00–16:00");
    expect(markup).toContain("Орлов Дмитрий Сергеевич");
    expect(markup).toContain('class="team-group__marker" style="background:#CBC04D"');
    expect(markup).toContain("<h3>Без времени</h3>");
    expect(markup).toContain("Отпуск");
    expect(markup).toContain("Весь день");
    expect(markup).toContain("Соколов Максим");
  });

  it("renders the Today empty guidance while preserving zero totals", () => {
    const model: TodayModel = {
      workingCount: 0,
      absentCount: 0,
      groups: [],
      noTimeGroups: [],
    };

    const markup = renderToStaticMarkup(
      createElement(TeamTodayView, { model, isDark: false }),
    );

    expect(markup).toContain("<b>0</b> На работе");
    expect(markup).toContain("<b>0</b> Отсутствует");
    expect(markup).toContain("На этот день записей нет");
    expect(markup).toContain("Выберите соседнюю дату стрелками.");
    expect(markup).not.toContain('class="team-today"');
  });

  it("uses theme-aware fallback markers in Today without changing exact operational colours", () => {
    const schedule = fallbackPaletteSchedule();
    const model = buildTodayModel("2026-07-27", schedule, fallbackPaletteTemplates);

    const light = renderToStaticMarkup(
      createElement(TeamTodayView, { model, isDark: false }),
    );
    const dark = renderToStaticMarkup(
      createElement(TeamTodayView, { model, isDark: true }),
    );

    expect(light).toContain('style="background:#CBC04D"');
    expect(dark).toContain('style="background:#CBC04D"');
    expect(light).toContain('style="background:#DEF5F0"');
    expect(dark).toContain('style="background:rgba(48,191,171,0.22)"');
    expect(light).toContain("Своя точка");
  });

  it("uses every existing light/dark fallback category palette in Week cells", () => {
    const schedule = fallbackPaletteSchedule();
    const model = buildWeekModel("2026-07-27", schedule, fallbackPaletteTemplates);

    const light = renderToStaticMarkup(
      createElement(TeamWeekGrid, {
        model,
        today: "2026-07-27",
        isDark: false,
      }),
    );
    const dark = renderToStaticMarkup(
      createElement(TeamWeekGrid, {
        model,
        today: "2026-07-27",
        isDark: true,
      }),
    );

    // На категорийной палитре осталось ровно то, что и правда «какая-то запись»:
    // смена или дежурство своим временем, без вида.
    expect(light).toContain("background:#DEF5F0");
    expect(dark).toContain("background:rgba(48,191,171,0.22)");
    // Точные цвета не зависят от темы и носят свою букву вместо общей точки —
    // командировка, мероприятие, больничный и работа в выходной.
    for (const markup of [light, dark]) {
      expect(markup).toContain("background:#8E24AA");
      expect(markup).toContain("<b>К</b>");
      expect(markup).toContain("background:#3949AB");
      expect(markup).toContain("<b>М</b>");
      expect(markup).toContain("background:#00897B");
      expect(markup).toContain("<b>Б</b>");
      expect(markup).toContain("background:#6D4C41");
      expect(markup).toContain("<b>РВ</b>");
    }
    expect(light).toContain("background:#CBC04D;color:#292505");
    expect(dark).toContain("background:#CBC04D;color:#292505");
    expect(light).toContain(">•<");
    expect(dark).toContain(">•<");
  });

  it("renders all seven dates, active rows, two-line names, exact palettes, and full cell labels", () => {
    const schedule: TeamSchedule = {
      employees: [
        { id: 20, displayName: "Орлов Дмитрий", rosterOrder: 0, excludedFromSwaps: false },
        { id: 10, displayName: "Соколов Максим", rosterOrder: 1, excludedFromSwaps: false },
        { id: 30, displayName: "Без Смены", rosterOrder: 2, excludedFromSwaps: false },
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
          unrecognisedCode: null,
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
          unrecognisedCode: null,
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
          unrecognisedCode: null,
          templateId: 2,
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
          unrecognisedCode: null,
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
          unrecognisedCode: null,
          templateId: null,
          employeeId: null,
        },
      ],
    
      calendar: [],
    };
    const templates = [
      { id: 6, name: "Дежурство с 07:00", accent: "amber", sortOrder: 0 },
      { id: 1, name: "Утро", accent: "gold", sortOrder: 1 },
      { id: 2, name: "День", accent: "blue", sortOrder: 2 },
    ] as const;
    const model = buildWeekModel("2026-07-27", schedule, templates);

    const markup = renderToStaticMarkup(
      createElement(TeamWeekGrid, {
        model,
        today: "2026-07-30",
        isDark: false,
      }),
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
      '<div class="team-week__name" role="rowheader"><b>Орлов</b><span>Дмитрий</span></div>',
    );
    expect(markup).toContain(
      '<div class="team-week__name" role="rowheader"><b>Без</b><span>Смены</span></div>',
    );
    expect(markup).toContain(
      '<div class="team-week__name" role="rowheader"><b>Не</b><span>назначено</span></div>',
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
      'aria-label="Орлов Дмитрий, 2026-07-27: Дежурство с 07:00, День"',
    );
    expect(markup).toContain(
      'aria-label="Соколов Максим, 2026-07-27: День, Отпуск"',
    );
    expect(markup).toContain(
      'role="gridcell" aria-label="Без Смены, 2026-07-27: нет записи"',
    );
    expect(markup).toContain(
      'style="background:#E3EFFC;color:#144F8F" aria-label="Не назначено, 2026-07-27: Открытая смена"',
    );
    expect(markup).toContain(
      'class="team-week__day is-today" data-date="2026-07-30"',
    );
    expect(markup).toContain(
      'class="team-week__day is-weekend" data-date="2026-08-01"',
    );
    expect(markup).toContain(
      'class="team-week__cell is-weekend" role="gridcell" aria-label="Соколов Максим, 2026-08-02: нет записи"',
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
        isDark: false,
      }),
    );
    expect(withoutUnassigned.match(/class="team-week__row"/g)).toHaveLength(3);
    expect(withoutUnassigned).not.toContain("Не назначено");
    expect(withoutUnassigned).toContain(
      '<div class="team-week__name" role="rowheader"><b>Без</b><span>Смены</span></div>',
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
          unrecognisedCode: null,
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
          unrecognisedCode: null,
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

    const selection = { employeeId: 20, date: "2026-07-30" };
    const model: WeekModel = {
      days: ["2026-07-30"],
      rows: [
        {
          employeeId: 20,
          displayName: "Орлов Дмитрий",
          cells: [cell],
        },
      ],
    };

    expect(resolveWeekCellSelection(model, selection)).toEqual(entries);
    expect(
      toTeamEntryDetailRows(resolveWeekCellSelection(model, selection)),
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

    const refreshedEntry: TeamEntryView = {
      ...entries[0]!,
      title: "Обновлённая выездная встреча",
    };
    expect(
      resolveWeekCellSelection(
        {
          ...model,
          rows: [
            {
              ...model.rows[0]!,
              cells: [
                {
                  ...cell,
                  entries: [refreshedEntry],
                  primary: refreshedEntry,
                  extraCount: 0,
                },
              ],
            },
          ],
        },
        selection,
      ),
    ).toEqual([refreshedEntry]);
    expect(
      resolveWeekCellSelection(
        {
          ...model,
          rows: [
            {
              ...model.rows[0]!,
              cells: [
                {
                  date: "2026-07-30",
                  entries: [],
                  primary: null,
                  extraCount: 0,
                },
              ],
            },
          ],
        },
        selection,
      ),
    ).toEqual([]);
    expect(
      resolveWeekCellSelection(model, {
        employeeId: 999,
        date: "2026-07-30",
      }),
    ).toEqual([]);
  });
});

describe("TeamWeekLegend", () => {
  const render = (items: Parameters<typeof TeamWeekLegend>[0]["items"], isDark = false) =>
    renderToStaticMarkup(createElement(TeamWeekLegend, { items, isDark }));

  it("shows each letter next to what it means", () => {
    const markup = render([
      { code: "П", label: "Дежурство · Поклонка", palette: { bg: "#FE87FF", fg: "#39133A", code: "П" }, category: null },
      { code: "Н", label: "Ночь", palette: { bg: "#20497C", fg: "#FFFFFF", code: "Н" }, category: null },
    ]);
    expect(markup).toContain("Что значат буквы");
    expect(markup).toContain("Дежурство · Поклонка");
    expect(markup).toContain("Ночь");
    // The swatch has to be the same colour the cell is drawn in, or it explains nothing.
    expect(markup).toContain("background:#FE87FF");
    expect(markup).toContain("background:#20497C");
  });

  it("colours a presetless entry by its category, per theme", () => {
    // Дежурство своим временем: у мероприятия, командировки, больничного и
    // работы в выходной с 2026-08-24 свои точные палитры, одни на обе темы, —
    // разницы между темами у них больше нет, а у записи без вида она осталась.
    const item = { code: "•", label: "Своя точка", palette: null, category: "duty" as const };
    const light = render([item], false);
    const dark = render([item], true);
    expect(light).toContain("Своя точка");
    expect(light).not.toBe(dark); // the category palette differs between themes
  });

  it("renders nothing at all for an empty week, rather than an empty box", () => {
    expect(render([])).toBe("");
  });
});
