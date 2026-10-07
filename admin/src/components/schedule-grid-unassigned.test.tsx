// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_CALENDAR } from "@planer/shared";
import { ScheduleGrid } from "./ScheduleGrid";
import type { Employee, Shift } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

const person = (id: number, displayName: string): Employee => ({ id, displayName } as Employee);
const PEOPLE = [person(1, "Иванова Анна"), person(2, "Петров Игорь"), person(3, "Семёнов Марк")];

const entry = (patch: Partial<Shift>): Shift => ({
  id: 1, date: WEEK[1]!, start: "08:00", end: "17:00", endDate: null, category: "shift", title: "Утро",
  location: null, unrecognisedCode: null, templateId: null, employeeId: null, ...patch,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(shifts: Shift[], extra: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(ScheduleGrid, {
        calendar: EMPTY_CALENDAR, employees: PEOPLE, shifts, templates: [], weekDates: WEEK,
        onAddClick: () => {}, onEntryClick: () => {}, ...extra,
      }),
    );
  });
  return host;
}

const names = (el: HTMLElement) => [...el.querySelectorAll("tbody .employee-name")].map((n) => n.textContent);
const unassignedRow = (el: HTMLElement) => el.querySelector<HTMLTableRowElement>("tr.unassigned-row");

/**
 * Строка «Не назначено»: открытые смены без человека. Без неё они в консоли
 * невидимы — строки сетки это активные работники, а `entriesFor` отбирает по
 * `employeeId`; будущие смены архивного работника, которые архивация делает
 * ничьими, пропадали с компьютера и были видны только в мини-аппе.
 */
describe("сетка — строка «Не назначено»", () => {
  it("в тихой неделе строки нет", async () => {
    const el = await render([entry({ id: 1, employeeId: 1 })]);
    expect(unassignedRow(el)).toBeNull();
    expect(names(el)).toEqual(["Иванова Анна", "Петров Игорь", "Семёнов Марк"]);
  });

  it("запись другой недели строку не рождает", async () => {
    const el = await render([entry({ date: "2026-08-24" })]);
    expect(unassignedRow(el)).toBeNull();
  });

  it("ничья запись недели даёт строку первой, над людьми", async () => {
    const el = await render([entry({ id: 5 })]);
    expect(names(el)).toEqual(["Не назначено", "Иванова Анна", "Петров Игорь", "Семёнов Марк"]);
    expect(el.querySelector("tbody tr")!.classList.contains("unassigned-row")).toBe(true);
  });

  it("чип стоит в своём дне, а у работников чужого чипа нет", async () => {
    const el = await render([entry({ id: 5, date: WEEK[2]! }), entry({ id: 6, employeeId: 2, date: WEEK[0]!, title: "День" })]);
    const cells = [...unassignedRow(el)!.querySelectorAll("td.day-cell")];
    expect(cells).toHaveLength(7);
    cells.forEach((cell, i) => expect(cell.querySelectorAll(".entry-chip")).toHaveLength(i === 2 ? 1 : 0));
    const igor = [...el.querySelectorAll("tbody tr")].find((r) => r.textContent?.includes("Петров Игорь"))!;
    expect(igor.querySelectorAll(".entry-chip")).toHaveLength(1);
  });

  it("ничья полоса отсутствия рисуется в каждом дне своего срока", async () => {
    const el = await render([entry({ id: 7, category: "vacation", start: null, end: null, title: null, date: WEEK[1]!, endDate: WEEK[3]! })]);
    const counts = [...unassignedRow(el)!.querySelectorAll("td.day-cell")].map((c) => c.querySelectorAll(".entry-chip").length);
    expect(counts).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });

  it("клик по чипу открывает запись, «＋» зовёт добавление без человека", async () => {
    const opened: Shift[] = [];
    const added: Array<[number | null, string]> = [];
    const shift = entry({ id: 8, date: WEEK[1]! });
    const el = await render([shift], {
      onEntryClick: (e: Shift) => opened.push(e),
      onAddClick: (id: number | null, date: string) => added.push([id, date]),
    });
    await act(async () => unassignedRow(el)!.querySelector<HTMLButtonElement>(".entry-chip")!.click());
    expect(opened).toEqual([shift]);
    await act(async () => unassignedRow(el)!.querySelector<HTMLButtonElement>(".empty-cell-add")!.click());
    await act(async () => unassignedRow(el)!.querySelector<HTMLButtonElement>(".cell-add-more")!.click());
    expect(added).toEqual([[null, WEEK[0]!], [null, WEEK[1]!]]);
  });

  it("пустой запрос строку оставляет, чужой запрос — прячет", async () => {
    const shifts = [entry({ id: 9 })];
    expect(unassignedRow(await render(shifts, { query: "" }))).not.toBeNull();
    await act(async () => root!.unmount());
    host!.remove();
    const el = await render(shifts, { query: "семён" });
    expect(unassignedRow(el)).toBeNull();
    expect(names(el)).toEqual(["Семёнов Марк"]);
  });

  it("запрос «не назн» строку находит, и «Никого с таким именем нет» молчит", async () => {
    const el = await render([entry({ id: 10 })], { query: "не назн" });
    expect(names(el)).toEqual(["Не назначено"]);
    expect(el.textContent).not.toContain("Никого с таким именем нет.");
  });

  it("поиск без совпадений по-прежнему говорит «Никого…», если ничьих записей нет", async () => {
    const el = await render([], { query: "не назн" });
    expect(el.textContent).toContain("Никого с таким именем нет.");
  });

  it("строка подписана «Не назначено» с пометкой «?» в кружке, как аватар мини-аппа", async () => {
    const el = await render([entry({ id: 11 })]);
    const row = unassignedRow(el)!;
    expect(row.querySelector(".employee-name")!.textContent).toBe("Не назначено");
    expect(row.querySelector(".avatar")!.textContent).toBe("?");
  });
});
