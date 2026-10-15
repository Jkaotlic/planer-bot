// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Employee, Shift, Template } from "../api/client";
import { EMPTY_CALENDAR } from "@planer/shared";
import { ScheduleGrid } from "./ScheduleGrid";

/**
 * Смена на человеке, который в этот день болеет (в отпуске, в командировке),
 * подписана «ждёт замены». Покрытие её уже не считает (`waitsForCover`), и
 * клетка, выглядящая как обычная смена, спорила бы с красной шапкой дня.
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

const MORNING: Shift = {
  id: 1, date: WEEK[0]!, endDate: null, start: "08:00", end: "17:00", employeeId: 1,
  category: "shift", templateId: 10, title: "Утро", location: null, unrecognisedCode: null,
};
const SICK: Shift = {
  id: 2, date: WEEK[0]!, endDate: WEEK[1]!, start: null, end: null, employeeId: 1,
  category: "sick_leave", templateId: null, title: null, location: null, unrecognisedCode: null,
};

function render(shifts: Shift[]) {
  return renderToStaticMarkup(
    createElement(ScheduleGrid, {
      calendar: EMPTY_CALENDAR,
      employees: EMPLOYEES,
      shifts,
      templates: TEMPLATES,
      weekDates: WEEK,
      onAddClick: () => {},
      onEntryClick: () => {},
      today: WEEK[0]!,
    }),
  );
}

describe("смена на отсутствующем в сетке консоли", () => {
  it("подписана «ждёт замены» и выделена классом", () => {
    const html = render([MORNING, SICK]);
    expect(html).toContain("Утро · ждёт замены");
    expect(html).toMatch(/class="entry-chip is-uncovered"/);
  });

  it("у здорового — обычная смена, без подписи", () => {
    const html = render([MORNING]);
    expect(html).not.toContain("ждёт замены");
    expect(html).not.toContain("is-uncovered");
  });

  it("сам больничный замены не ждёт", () => {
    const html = render([SICK]);
    expect(html).not.toContain("ждёт замены");
  });
});
