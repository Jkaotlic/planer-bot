// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/**
 * Три галки ограничений свёрнуты за строку «Ограничения: …»: на карточке из
 * тридцати они занимали больше места, чем всё остальное, а нужны почти никому.
 * Свёрнутая строка при этом обязана сказать то, ради чего галки смотрят.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
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

async function mount(list: Employee[]) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue(list);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null)));
  });
  await settle();
  return host;
}

const card = (el: HTMLElement, id: number) => el.querySelector<HTMLElement>(`[data-employee-id="${id}"]`)!;
const fold = (el: HTMLElement, id: number) =>
  [...card(el, id).querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").startsWith("Ограничения:"))!;
const boxes = (el: HTMLElement, id: number) => card(el, id).querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

describe("ограничения работника под раскрытием", () => {
  it("без ограничений: строка «Ограничения: нет», закрыта, галок в DOM нет", async () => {
    const el = await mount([person(1, "Аня")]);
    const row = fold(el, 1);
    expect(row.textContent).toContain("Ограничения: нет");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(boxes(el, 1)).toHaveLength(0);
  });

  it.each([
    [{ isObserver: true }, "Ограничения: наблюдатель"],
    [{ excludedFromAssignment: true }, "Ограничения: без назначений"],
    [{ excludedFromSwaps: true }, "Ограничения: без обменов"],
    [{ excludedFromAssignment: true, excludedFromSwaps: true }, "Ограничения: без назначений, без обменов"],
    [{ isObserver: true, excludedFromAssignment: true, excludedFromSwaps: true }, "Ограничения: наблюдатель, без назначений, без обменов"],
  ] as Array<[Partial<Employee>, string]>)("сводка %j → «%s»", async (over, text) => {
    const el = await mount([person(1, "Аня", over)]);
    expect(fold(el, 1).textContent).toContain(text);
  });

  it("нажатие раскрывает: три галки с прежними подписями и пояснениями", async () => {
    const el = await mount([person(1, "Аня")]);
    await act(async () => fold(el, 1).click());
    expect(fold(el, 1).getAttribute("aria-expanded")).toBe("true");
    expect(boxes(el, 1)).toHaveLength(3);
    const text = card(el, 1).textContent ?? "";
    expect(text).toContain("Наблюдатель");
    expect(text).toContain("Смотрит график, ведёт свой, шлёт анонсы.");
    expect(text).toContain("Не участвует в назначениях");
    expect(text).toContain("бот не зовёт его на работу в выходные");
    expect(text).toContain("Не участвует в обменах");
    expect(text).toContain("ни предложить, ни принять обмен");
  });

  it("у наблюдателя две нижние галки disabled и показывают значение из базы", async () => {
    const el = await mount([person(5, "Марк", { isObserver: true, excludedFromAssignment: true })]);
    await act(async () => fold(el, 5).click());
    const [observer, assignment, swaps] = [...boxes(el, 5)];
    expect(observer!.disabled).toBe(false);
    expect(observer!.checked).toBe(true);
    expect(assignment!.disabled).toBe(true);
    expect(assignment!.checked).toBe(true);
    expect(swaps!.disabled).toBe(true);
    expect(swaps!.checked).toBe(false);
  });

  it("галки зовут те же методы apiClient", async () => {
    const restrict = vi.spyOn(apiClient, "setEmployeeRestrictions").mockResolvedValue(undefined);
    const observer = vi.spyOn(apiClient, "setEmployeeObserver").mockResolvedValue(undefined);
    const el = await mount([person(1, "Аня")]);
    await act(async () => fold(el, 1).click());
    await act(async () => boxes(el, 1)[2]!.click());
    await settle();
    expect(restrict).toHaveBeenCalledWith(1, { excludedFromSwaps: true });
    await act(async () => boxes(el, 1)[0]!.click());
    await settle();
    expect(observer).toHaveBeenCalledWith(1, true);
  });

  it("после переключения галки сводка в свёрнутой строке меняется", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockResolvedValue(undefined);
    const el = await mount([person(1, "Аня")]);
    expect(fold(el, 1).textContent).toContain("Ограничения: нет");
    await act(async () => fold(el, 1).click());
    await act(async () => boxes(el, 1)[2]!.click());
    await settle();
    // Сворачиваем и читаем именно свёрнутую строку: ради неё сводка и написана.
    await act(async () => fold(el, 1).click());
    expect(fold(el, 1).getAttribute("aria-expanded")).toBe("false");
    expect(fold(el, 1).textContent).toContain("Ограничения: без обменов");
    expect(fold(el, 1).textContent).not.toContain("нет");
  });

  it("отказ сохранения виден, когда карточка свёрнута", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("Сервер отказал"));
    const el = await mount([person(1, "Аня")]);
    await act(async () => fold(el, 1).click());
    await act(async () => boxes(el, 1)[2]!.click());
    await settle();
    await act(async () => fold(el, 1).click());
    expect(boxes(el, 1)).toHaveLength(0);
    const alert = card(el, 1).querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent ?? "").not.toBe("");
    // Сводка при этом прежняя: сохранение не прошло.
    expect(fold(el, 1).textContent).toContain("Ограничения: нет");
  });

  it("раскрытие одной карточки не трогает соседнюю", async () => {
    const el = await mount([person(1, "Аня"), person(2, "Игорь")]);
    await act(async () => fold(el, 1).click());
    expect(boxes(el, 1)).toHaveLength(3);
    expect(boxes(el, 2)).toHaveLength(0);
    expect(fold(el, 2).getAttribute("aria-expanded")).toBe("false");
  });

  it("«привязан», «не привязан», «админ» — пилюли, а не кнопки", async () => {
    const el = await mount([person(1, "Аня", { isAdmin: true }), person(2, "Игорь", { telegramUserId: null })]);
    const pill = (id: number, text: string) =>
      [...card(el, id).querySelectorAll<HTMLElement>(".ui-pill")].find((p) => p.textContent === text);
    expect(pill(1, "привязан")).toBeTruthy();
    expect(pill(1, "админ")).toBeTruthy();
    expect(pill(2, "не привязан")).toBeTruthy();
    for (const p of card(el, 1).querySelectorAll(".ui-pill")) expect(p.tagName).not.toBe("BUTTON");
    expect(pill(1, "привязан")!.closest("button")).toBeNull();
  });
});
