// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Праздник в дне расписания: подпись и три кнопки.
 *
 * «Как в календаре» показывается только у дня, отмеченного руками: у
 * автоматического дня снимать нечего, и кнопка обещала бы работу, которой нет.
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

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

/** Календарь на КАЖДЫЙ день недели: экран открывается на сегодняшнем дне. */
function everyDay(kind: "holiday" | "workday", source: "auto" | "manual", note: string | null) {
  return async (from: string, to: string) => {
    const days: { date: string; kind: "holiday" | "workday"; note: string | null; source: "auto" | "manual" }[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push({ date: d.toISOString().slice(0, 10), kind, note, source });
    }
    return { shifts: [], employees: [], calendar: days };
  };
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen)));
  });
  await settle();
  return host;
}

describe("отметка дня на экране расписания", () => {
  it("подписывает праздник и предлагает сделать день рабочим", async () => {
    vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(everyDay("holiday", "auto", "День России"));

    const el = await mount();

    expect(el.textContent ?? "").toContain("День России");
    expect(el.textContent ?? "").toContain("Сделать рабочим");
    // Снимать нечего: день пришёл из календаря, а не поставлен руками.
    expect(el.textContent ?? "").not.toContain("Как в календаре");
  });

  it("у дня, отмеченного руками, есть возврат «Как в календаре»", async () => {
    vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(everyDay("workday", "manual", null));

    const el = await mount();

    expect(el.textContent ?? "").toContain("Рабочая");
    expect(el.textContent ?? "").toContain("вручную");
    expect(el.textContent ?? "").toContain("Как в календаре");
  });

  it("нажатие «Сделать выходным» шлёт отметку и перечитывает неделю", async () => {
    const schedule = vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] });
    const setDay = vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(null);

    const el = await mount();
    const before = schedule.mock.calls.length;
    const button = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Сделать выходным"));
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    await settle(4);

    expect(setDay).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), "holiday");
    expect(schedule.mock.calls.length).toBeGreaterThan(before);
  });
});
