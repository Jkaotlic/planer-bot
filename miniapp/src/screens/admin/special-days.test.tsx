// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Праздники и рабочие субботы на админском графике.
 *
 * Полоска дней красила выходной по дню недели, и праздник в среду выглядел
 * рабочим днём. Название стоит текстом под полоской, а не в `title`: на
 * телефоне подсказки по наведению нет.
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

// Среда: неделя 24–30 августа 2026, понедельник — первая клетка полоски.
const TODAY = "2026-08-26";
// Четверг, а не сегодняшняя среда: выбранный день красится «выбран», и серость на нём не видна.
const HOLIDAY = [{ date: "2026-08-27", kind: "holiday" as const, note: "Праздник", source: "auto" as const }];

async function mount(calendar: { date: string; kind: "holiday" | "workday"; note: string | null; source: "auto" | "manual" }[] = HOLIDAY) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-day-chip]")];

describe("праздники на полоске дней админского графика", () => {
  it("будний праздник помечен значком и серым, как выходной", async () => {
    const thu = chips(await mount())[3]!;
    expect(thu.dataset.dayKind).toBe("holiday");
    expect(thu.textContent).toContain("🎉");
    expect(thu.style.color).toContain("hint_color");
    // Сосед без праздника — обычный цвет и без значка.
    expect(chips(host!)[4]!.style.color).not.toContain("hint_color");
    expect(chips(host!)[4]!.dataset.dayKind).toBeUndefined();
  });

  it("рабочая суббота не серая и несёт значок 💼", async () => {
    const el = await mount([{ date: "2026-08-29", kind: "workday", note: null, source: "manual" }]);
    const sat = chips(el)[5]!;
    expect(sat.dataset.dayKind).toBe("workday");
    expect(sat.textContent).toContain("💼");
    expect(sat.style.color).not.toContain("hint_color");
    // Воскресенье без записи в календаре остаётся серым по правилу выходных.
    expect(chips(el)[6]!.style.color).toContain("hint_color");
  });

  it("под полоской — строка с названием праздника текстом, а не в подсказке", async () => {
    const el = await mount();
    const line = el.querySelector("[data-special-days]")!;
    expect(line.textContent).toContain("🎉 Чт 27 — Праздник");
    const strip = chips(el)[0]!;
    expect(strip.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("обычная неделя — строки нет", async () => {
    const el = await mount([]);
    expect(el.querySelector("[data-special-days]")).toBeNull();
    expect(chips(el).some((chip) => chip.dataset.dayKind)).toBe(false);
  });
});
