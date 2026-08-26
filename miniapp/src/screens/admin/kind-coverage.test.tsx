// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type TemplateRolesView } from "../../api/client";
import { AdminKindSettings } from "./AdminKindSettings";

/**
 * Редактор нормы дня: семь полей Пн..Вс на карточке вида смены.
 *
 * Сохранение одной кнопкой, а не по каждой цифре: поля правят подряд, и запрос
 * на каждое нажатие означал бы семь запросов и семь строк в журнале на одну
 * правку.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MORNING: TemplateRolesView = {
  templateId: 10, name: "Утро", category: "shift", accent: "gold", checklistId: null, sendReminder: false, reminderText: null,
  coverage: [0, 0, 0, 0, 0, 0, 0], pool: [], preference: {},
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminKindSettings, { onClose: () => {} })));
  });
  await settle();
  return host;
}

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

describe("норма дня на карточке вида смены", () => {
  it("сохраняется семью числами по одной кнопке", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([MORNING]);
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTemplateQueue").mockRejectedValue(new Error("не нужно"));
    const save = vi.spyOn(apiClient, "setTemplateCoverage").mockResolvedValue(undefined);

    const el = await mount();
    await act(async () => (el.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
    await settle();

    // Пока ничего не тронуто — сохранять нечего, и кнопки нет.
    expect(button(el, "Сохранить норму")).toBeUndefined();

    await type(el.querySelector('input[aria-label="Утро: норма на Пн"]') as HTMLInputElement, "3");
    await settle();
    await act(async () => button(el, "Сохранить норму")!.click());
    await settle();

    expect(save).toHaveBeenCalledWith(10, [3, 0, 0, 0, 0, 0, 0]);
  });

  it("показывает норму словами, а не строкой из базы", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([{ ...MORNING, coverage: [2, 2, 2, 2, 2, 0, 0] }]);
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);

    const el = await mount();

    expect(el.textContent ?? "").toContain("Пн 2 · Вт 2 · Ср 2 · Чт 2 · Пт 2");
    // Нулевые дни в сводку не попадают — это «не считаем», а не «ноль людей».
    expect(el.textContent ?? "").not.toContain("Сб 0");
  });
});
