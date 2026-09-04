// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildWeekModel, calendarFrom, EMPTY_CALENDAR, type SchedulePresetLike } from "@planer/shared";
import { TeamWeekGrid } from "./TeamWeekGrid";

/**
 * Праздник в сетке команды: серая колонка и подпись в шапке дня.
 *
 * Проверяется класс и подпись, а не цвет: цвет задаёт тема, а класс — то самое
 * решение «этот день выходной», которое календарь и меняет.
 */
const MONDAY = "2026-08-03";
const PRESETS: SchedulePresetLike[] = [{ id: 1, name: "День", accent: "blue", sortOrder: 1 }];
const TEAM = [{ id: 1, displayName: "Иванов Иван", rosterOrder: 0 }];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(calendar = EMPTY_CALENDAR) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [] }, PRESETS);
  await act(async () => {
    root!.render(createElement(TeamWeekGrid, { model, today: "2026-08-04", isDark: false, calendar }));
  });
  return host;
}

function dayCell(el: HTMLElement, date: string): HTMLElement {
  const cell = el.querySelector<HTMLElement>(`.team-week__day[data-date="${date}"]`);
  if (!cell) throw new Error(`нет шапки дня ${date}`);
  return cell;
}

describe("TeamWeekGrid и календарь праздников", () => {
  it("без календаря выходные — суббота и воскресенье", async () => {
    const el = await mount();
    expect(dayCell(el, "2026-08-08").className).toContain("is-weekend");
    expect(dayCell(el, "2026-08-05").className).not.toContain("is-weekend");
  });

  it("праздник в будни красится как выходной и подписан названием", async () => {
    const cal = calendarFrom([{ date: "2026-08-05", kind: "holiday" }]);
    const el = await mount(cal);
    const wednesday = dayCell(el, "2026-08-05");
    expect(wednesday.className).toContain("is-weekend");
    expect(wednesday.textContent).toContain("🎉");
  });

  it("перенесённая рабочая суббота выходным не красится", async () => {
    const cal = calendarFrom([{ date: "2026-08-08", kind: "workday" }]);
    const el = await mount(cal);
    const saturday = dayCell(el, "2026-08-08");
    expect(saturday.className).not.toContain("is-weekend");
    expect(saturday.textContent).toContain("💼");
  });
});
