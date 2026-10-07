// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Shift } from "./api/client";
import { App } from "./App";
import { mondayOf, toISODate } from "./lib/week";

/**
 * Проводка «ничьей» смены от сетки до панели: App переводит `null` из строки
 * «Не назначено» в «никого не выбрано» (0), а не в «первого из списка» — `??`
 * на этом месте молча подставил бы работника, и открытая смена, сохранённая
 * без взгляда на поле, стала бы чужой.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

const MONDAY = toISODate(mondayOf(new Date()));

const open: Shift = {
  id: 9001, date: MONDAY, start: "08:00", end: "17:00", endDate: null, category: "shift",
  title: "Утро", location: null, unrecognisedCode: null, templateId: null, employeeId: null,
};

async function mount() {
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([open]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

describe("ничья смена в консоли — от строки сетки до запроса", () => {
  it("строка «Не назначено» видна, «＋» открывает панель без человека и шлёт null", async () => {
    const el = await mount();
    const row = el.querySelector<HTMLElement>("tr.unassigned-row");
    expect(row).not.toBeNull();

    const create = vi.spyOn(apiClient, "createEntry").mockResolvedValue({ entry: open, notified: { delivered: 0, intended: 0 } });
    await act(async () => row!.querySelector<HTMLButtonElement>(".cell-add-more, .empty-cell-add")!.click());
    await settle(2);
    const panel = el.querySelector<HTMLElement>(".panel")!;
    expect(panel.querySelector(".person-picker-chosen")!.textContent).toContain("— не назначен —");

    await act(async () => [...panel.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click());
    await settle(4);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].employeeId).toBeNull();
  });

  it("клик по чипу открывает ничью запись с «— не назначен —»", async () => {
    const el = await mount();
    await act(async () => el.querySelector<HTMLButtonElement>("tr.unassigned-row .entry-chip")!.click());
    await settle(2);
    expect(el.querySelector(".panel .person-picker-chosen")!.textContent).toContain("— не назначен —");
  });
});
