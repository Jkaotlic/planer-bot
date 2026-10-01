// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Employee, Shift, Template } from "../api/client";
import { EMPTY_CALENDAR } from "@planer/shared";
import { ScheduleGrid } from "./ScheduleGrid";

/**
 * Красная метка «−1» в шапке колонки: сколько людей не хватает в этом дне.
 *
 * Числом, а не перечнем видов: перечень в колонке шириной в день обрезался
 * многоточием и читался серым примечанием. Расклад по видам — во всплывающей
 * подсказке и в строке над сеткой.
 *
 * Молчание по умолчанию — половина смысла: норма у видов смен нулевая, пока её
 * не задали, и семь колонок с «не хватает» читались бы как поломка сетки.
 */

const WEEK = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

const EMPLOYEES: Employee[] = [{
  id: 1, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11,
  birthDate: null, preferredName: null, address: "Игорь",
  excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
}];

const TEMPLATES: Template[] = [
  { id: 10, name: "Утро", category: "shift", start: "08:00", end: "17:00", fridayStart: null, fridayEnd: null, location: null, accent: "gold", isLate: false, sendReminder: false, sortOrder: 1 },
];

const MORNING = { templateId: 10, name: "Утро", coverage: [2, 0, 0, 0, 0, 0, 0] };

function render(props: { shifts?: Shift[]; coverage?: { templateId: number; name: string; coverage: number[] }[] } = {}) {
  return renderToStaticMarkup(
    createElement(ScheduleGrid, {
      calendar: EMPTY_CALENDAR,
      employees: EMPLOYEES,
      shifts: props.shifts ?? [],
      templates: TEMPLATES,
      weekDates: WEEK,
      onAddClick: () => {},
      onEntryClick: () => {},
      coverage: props.coverage,
      today: WEEK[0]!,
    }),
  );
}

function badges(html: string): string[] {
  return [...html.matchAll(/<span class="day-short-badge"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!);
}

describe("нехватка по норме в шапке колонки дня", () => {
  it("молчит, когда нормы нет", () => {
    expect(badges(render())).toEqual([]);
  });

  it("показывает отдельной меткой, сколько людей не хватает в этот день", () => {
    expect(badges(render({ coverage: [MORNING] }))).toEqual(["−2"]);
  });

  it("считает уже поставленных", () => {
    const shifts: Shift[] = [{
      id: 1, date: WEEK[0]!, endDate: null, start: "08:00", end: "17:00", employeeId: 1,
      category: "shift", templateId: 10, title: "Утро", location: null, unrecognisedCode: null,
    }];
    expect(badges(render({ shifts, coverage: [MORNING] }))).toEqual(["−1"]);
  });

  it("складывает виды в одно число, а расклад отдаёт подсказке", () => {
    const duty = { templateId: 20, name: "Дежурство", coverage: [1, 0, 0, 0, 0, 0, 0] };
    const html = render({ coverage: [MORNING, duty] });
    expect(badges(html)).toEqual(["−3"]);
    expect(html).toContain('title="Не хватает: Утро — 2, Дежурство — 1"');
  });

  it("не рисует метку в дни с нулевой нормой", () => {
    // Норма задана только на понедельник — во вторник..воскресенье метки нет,
    // иначе один настроенный вид смены засорил бы всю неделю.
    const html = render({ coverage: [{ ...MORNING, coverage: [2, 0, 3, 0, 0, 0, 0] }] });
    expect(badges(html)).toEqual(["−2", "−3"]);
  });

  it("выделяет колонку дня, на который показали из строки над сеткой", () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleGrid, {
        calendar: EMPTY_CALENDAR, employees: EMPLOYEES, shifts: [], templates: TEMPLATES, weekDates: WEEK,
        onAddClick: () => {}, onEntryClick: () => {}, coverage: [MORNING], today: WEEK[6]!, highlightDate: WEEK[0]!,
      }),
    );
    // Шапка и клетка единственного работника — и ни одной другой колонки.
    expect(html.split("pointed-col").length - 1).toBe(2);
  });
});
