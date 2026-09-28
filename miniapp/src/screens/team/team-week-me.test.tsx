// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildWeekModel, EMPTY_CALENDAR, type SchedulePresetLike } from "@planer/shared";
import { TeamWeekGrid } from "./TeamWeekGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Своя строка среди ~26 ничем не отличалась — человек искал себя глазами
 * по фамилии каждый раз.
 */
const PRESETS: SchedulePresetLike[] = [{ id: 1, name: "День", accent: "blue", sortOrder: 1 }];
const TEAM = [
  { id: 1, displayName: "Иванов Иван", rosterOrder: 0 },
  { id: 2, displayName: "Смирнова Аня", rosterOrder: 1 },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
});

describe("своя строка в сетке недели", () => {
  it("отмечена — и только она", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const model = buildWeekModel("2026-08-03", { employees: TEAM, shifts: [] }, PRESETS);
    await act(async () => {
      root!.render(createElement(TeamWeekGrid, { model, today: "2026-08-04", isDark: false, calendar: EMPTY_CALENDAR, meId: 2 }));
    });
    const mine = host.querySelectorAll('[role="rowheader"][aria-current="true"]');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.textContent).toContain("Смирнова");
  });
});
