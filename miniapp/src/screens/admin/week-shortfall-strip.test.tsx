// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type TemplateRolesView } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Нехватка недели на полоске дней админского графика.
 *
 * Подсказка «Не хватает: Утро — 1» стоит только у выбранного дня, и чтобы
 * увидеть неделю, приходилось протыкать семь дней. Метка на самом дне отвечает
 * сразу за все семь, и отдельной сводки над полоской не нужно.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kind = (templateId: number, coverage: number[]): TemplateRolesView => ({
  templateId, name: `Вид ${templateId}`, category: "shift", accent: "gold", checklistIds: [], sendReminder: false, reminderText: null,
  coverage, pool: [], preference: {},
});

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

async function mount(roles: TemplateRolesView[]) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(roles);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("[data-day-chip]")];
const marks = (el: HTMLElement) => chips(el).map((chip) => chip.querySelector("[data-day-short]")?.textContent ?? null);

describe("нехватка на полоске дней недели", () => {
  it("метка стоит на каждом дне с дырой, а не только на выбранном", async () => {
    const el = await mount([kind(10, [2, 0, 1, 0, 3, 0, 0])]);
    expect(marks(el)).toEqual(["2", null, "1", null, "3", null, null]);
  });

  it("складывает виды одного дня в одно число", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0]), kind(20, [1, 0, 0, 0, 0, 0, 0])]);
    expect(marks(el)[0]).toBe("3");
  });

  it("метка говорит словами тому, кто её не видит", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    expect(chips(el)[0]!.getAttribute("aria-label")).toContain("не хватает 2");
    expect(chips(el)[1]!.getAttribute("aria-label") ?? "").not.toContain("не хватает");
  });

  it("закрытая неделя с заданными нормами не добавляет на экран ничего", async () => {
    const el = await mount([]);
    expect(marks(el)).toEqual([null, null, null, null, null, null, null]);
    expect(el.querySelector("[data-norm-unset]")).toBeNull();
  });

  it("виды без нормы — одной строкой под полоской, и она ведёт в «Виды смен»", async () => {
    const el = await mount([kind(10, [0, 0, 0, 0, 0, 0, 0]), kind(20, [0, 0, 0, 0, 0, 0, 0])]);
    const line = el.querySelector<HTMLButtonElement>("[data-norm-unset]")!;
    expect(line.textContent).toBe("Без нормы: 2 вида — задать →");
    const strip = chips(el)[6]!;
    expect(strip.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => line.click());
    await settle(4);
    // Экран сменился на редактор видов: полоска дней под ним не показывается.
    expect(chips(el)).toHaveLength(0);
    expect(el.textContent ?? "").toContain("Виды смен");
  });

  it("после возврата из «Видов смен» полоска считает по свежим нормам", async () => {
    // Нормы читались один раз при открытии экрана: строка вела в настройку, а
    // по возвращении продолжала говорить «без нормы».
    const el = await mount([kind(10, [0, 0, 0, 0, 0, 0, 0])]);
    await act(async () => el.querySelector<HTMLButtonElement>("[data-norm-unset]")!.click());
    await settle(4);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind(10, [1, 0, 0, 0, 0, 0, 0])]);
    const back = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => /Назад|Готово|Закрыть/.test(b.textContent ?? ""))!;
    await act(async () => back.click());
    await settle();
    expect(el.querySelector("[data-norm-unset]")).toBeNull();
    expect(marks(el)[0]).toBe("1");
  });
});
