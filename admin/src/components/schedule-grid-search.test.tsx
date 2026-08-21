// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleGrid } from "./ScheduleGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIX_PEOPLE = [
  { id: 1, displayName: "Иванова Анна" },
  { id: 2, displayName: "Петров Игорь" },
  { id: 3, displayName: "Семёнов Марк" },
  { id: 4, displayName: "Соколова Вера" },
  { id: 5, displayName: "Кузнецов Пётр" },
  { id: 6, displayName: "Орлова Ника" },
];

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function mountGrid(employees: unknown[], extra: { query?: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ScheduleGrid, {
      employees, shifts: [], templates: [], weekDates: WEEK,
      onAddClick: () => {}, onEntryClick: () => {}, ...extra,
    } as never));
  });
  return host;
}

describe("поиск по гриду расписания", () => {
  it("оставляет строки совпавших и прячет остальные", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "семён" });
    expect([...el.querySelectorAll(".employee-name")].map((n) => n.textContent)).toEqual(["Семёнов Марк"]);
  });

  it("пустой запрос показывает всех", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "" });
    expect(el.querySelectorAll(".employee-name")).toHaveLength(6);
  });

  it("шапка недели остаётся на месте — поиск фильтрует людей, а не дни", async () => {
    const el = await mountGrid(SIX_PEOPLE, { query: "семён" });
    expect(el.querySelectorAll("thead th").length).toBeGreaterThan(1);
  });
});
