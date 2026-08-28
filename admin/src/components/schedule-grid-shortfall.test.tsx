// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Employee, Shift, Template } from "../api/client";
import { ScheduleGrid } from "./ScheduleGrid";

/**
 * «−1 Утро» под датой: чего в этом дне не хватает против нормы.
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

describe("нехватка по норме в шапке колонки дня", () => {
  it("молчит, когда нормы нет", () => {
    expect(render()).not.toContain("Утро");
  });

  it("показывает, сколько людей не хватает в этот день", () => {
    expect(render({ coverage: [MORNING] })).toContain("−2 Утро");
  });

  it("считает уже поставленных", () => {
    const shifts: Shift[] = [{
      id: 1, date: WEEK[0]!, endDate: null, start: "08:00", end: "17:00", employeeId: 1,
      category: "shift", templateId: 10, title: "Утро", location: null, unrecognisedCode: null,
    }];
    expect(render({ shifts, coverage: [MORNING] })).toContain("−1 Утро");
  });

  it("не рисует нехватку в дни с нулевой нормой", () => {
    // Норма задана только на понедельник — во вторник..воскресенье подсказки нет,
    // иначе один настроенный вид смены засорил бы всю неделю.
    const html = render({ coverage: [MORNING] });
    expect(html.split("−2 Утро").length - 1).toBe(1);
  });
});
