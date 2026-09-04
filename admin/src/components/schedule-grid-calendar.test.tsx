// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calendarFrom, EMPTY_CALENDAR } from "@planer/shared";
import { ScheduleGrid } from "./ScheduleGrid";

/**
 * Праздник в сетке консоли красится как выходной, перенесённая рабочая суббота —
 * нет. Тот же календарь, что у сервера и мини-аппа: три сетки, одно правило.
 */
const WEEK = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];

function markup(calendar = EMPTY_CALENDAR): string {
  return renderToStaticMarkup(
    createElement(ScheduleGrid, {
      employees: [],
      shifts: [],
      templates: [],
      weekDates: WEEK,
      calendar,
      onAddClick: () => {},
      onEntryClick: () => {},
    }),
  );
}

/** Индексы колонок недели, помеченных как выходные: шапка идёт по порядку дней. */
function weekendIndexes(html: string): number[] {
  const doc = new DOMParser().parseFromString(`<table>${html}</table>`, "text/html");
  const headers = [...doc.querySelectorAll("thead th")].slice(1);
  return headers.flatMap((th, index) => (th.className.includes("weekend-col") ? [index] : []));
}

describe("ScheduleGrid и календарь праздников", () => {
  it("без календаря выходные — суббота и воскресенье", () => {
    // Пятая и шестая колонки недели — суббота и воскресенье.
    expect(weekendIndexes(markup())).toEqual([5, 6]);
  });

  it("праздник в будни красится, перенесённая рабочая суббота — нет", () => {
    const html = markup(calendarFrom([{ date: "2026-08-05", kind: "holiday" }, { date: "2026-08-08", kind: "workday" }]));
    // Среда стала выходным, суббота — рабочей: серые среда и воскресенье.
    expect(weekendIndexes(html)).toEqual([2, 6]);
  });
});
