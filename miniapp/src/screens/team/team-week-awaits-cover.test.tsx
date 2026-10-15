// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildWeekLegend, buildWeekModel, EMPTY_CALENDAR, type SchedulePresetLike } from "@planer/shared";
import type { Shift } from "../../api/client";
import { TeamWeekGrid } from "./TeamWeekGrid";
import { TeamWeekLegend } from "./TeamWeekLegend";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Смена больного стояла в командной сетке обычной буквой: работник видел, что «Д»
 * в понедельник закрыт, а смена ждёт замены. Метка — рамка клетки и слова в
 * aria-label; легенда объясняет рамку отдельной строкой.
 */
const PRESETS: SchedulePresetLike[] = [{ id: 1, name: "День", accent: "blue", sortOrder: 1 }];
const TEAM = [
  { id: 1, displayName: "Иванов Игорь", rosterOrder: 0 },
  { id: 2, displayName: "Смирнова Аня", rosterOrder: 1 },
];
const MONDAY = "2026-08-03";

let nextId = 1;
function entry(over: Partial<Shift>): Shift {
  return {
    id: nextId++, location: null, employeeId: 1, date: MONDAY, endDate: null, start: "08:00", end: "20:00",
    category: "shift", title: null, templateId: 1, unrecognisedCode: null, ...over,
  };
}

const SHIFTS = [
  entry({ category: "sick_leave", templateId: null, start: null, end: null }),
  entry({}),
  entry({ employeeId: 2 }),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
});

async function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

describe("командная сетка: смена на отсутствующем", () => {
  it("клетка больного в рамке и названа «ждёт замены», клетка здорового — нет", async () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: SHIFTS }, PRESETS, { markAwaitingCover: true });
    const el = await render(createElement(TeamWeekGrid, { model, today: MONDAY, isDark: false, calendar: EMPTY_CALENDAR }));
    const cells = [...el.querySelectorAll<HTMLButtonElement>("button.team-week__cell")];
    const igor = cells.find((c) => c.getAttribute("aria-label")!.startsWith("Иванов Игорь"))!;
    const anya = cells.find((c) => c.getAttribute("aria-label")!.startsWith("Смирнова Аня"))!;
    expect(igor.classList.contains("is-awaiting-cover")).toBe(true);
    expect(igor.getAttribute("aria-label")).toContain("День (ждёт замены)");
    expect(anya.classList.contains("is-awaiting-cover")).toBe(false);
    expect(anya.getAttribute("aria-label")).not.toContain("ждёт замены");
  });

  it("легенда: строка «День (ждёт замены)» с квадратом в той же рамке", async () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: SHIFTS }, PRESETS, { markAwaitingCover: true });
    const el = await render(createElement(TeamWeekLegend, { items: buildWeekLegend(model), isDark: false }));
    const items = [...el.querySelectorAll(".team-legend__item")];
    const marked = items.find((i) => i.textContent!.includes("ждёт замены"))!;
    expect(marked.textContent).toContain("День (ждёт замены)");
    expect(marked.querySelector(".team-legend__code")!.classList.contains("is-awaiting-cover")).toBe(true);
    const plain = items.find((i) => !i.textContent!.includes("ждёт замены"))!;
    expect(plain.querySelector(".team-legend__code")!.classList.contains("is-awaiting-cover")).toBe(false);
  });
});
