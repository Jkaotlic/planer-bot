import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Shift, TeamSchedule } from "../../api/client";
import { buildTodayModel, type TodayModel } from "../../lib/team-schedule";
import { TeamRangeNav } from "./TeamRangeNav";
import { TeamTodayView } from "./TeamTodayView";
import { TeamViewSwitcher } from "./TeamViewSwitcher";

describe("team schedule UI", () => {
  it("renders Today and Week as labelled tabs with the current tab selected", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamViewSwitcher, {
        value: "today",
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Вид расписания"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain(">Сегодня<");
    expect(markup).toContain(">Неделя<");
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
});
