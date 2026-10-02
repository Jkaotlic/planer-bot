// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restrictionsSummary } from "@planer/shared";
import { apiClient, type Employee } from "./api/client";
import { EmployeesScreen } from "./screens/EmployeesScreen";

/**
 * Ограничения работника свёрнуты в строку «Ограничения: …» — как в мини-аппе.
 * Это единственная намеренная смена поведения консоли в этой ветке: админ,
 * листая список, должен видеть исключённых, не раскрывая каждую карточку.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function emp(id: number, name: string, over: Partial<Employee> = {}): Employee {
  return {
    id, displayName: name, isAdmin: false, isActive: true, telegramUserId: 100 + id, birthDate: null,
    preferredName: null, address: name, excludedFromAssignment: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
  };
}

const COMBOS: Array<[string, Partial<Employee>]> = [
  ["наблюдатель", { isObserver: true }],
  ["без назначений", { excludedFromAssignment: true }],
  ["без обменов", { excludedFromSwaps: true }],
  ["без назначений и обменов", { excludedFromAssignment: true, excludedFromSwaps: true }],
  ["все три", { isObserver: true, excludedFromAssignment: true, excludedFromSwaps: true }],
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function Harness({ initial }: { initial: Employee[] }) {
  const [employees, setEmployees] = useState(initial);
  return createElement(EmployeesScreen, {
    employees,
    onChanged: async () => {},
    onRestrictionsSaved: (id, patch) => setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    onObserverSaved: (id, isObserver) => setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, isObserver } : e))),
  });
}

async function mount(initial: Employee[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Harness, { initial }));
  });
  await settle();
  return host;
}

const card = (el: HTMLElement, id: number) => el.querySelector(`[data-employee-id="${id}"]`) as HTMLElement;
const toggleOf = (el: HTMLElement, id: number) =>
  card(el, id).querySelector("button.employee-restrictions-toggle") as HTMLButtonElement;
const boxes = (el: HTMLElement, id: number) =>
  [...card(el, id).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

async function expand(el: HTMLElement, id: number) {
  await act(async () => toggleOf(el, id).click());
}

describe("ограничения работника свёрнуты", () => {
  it("без ограничений: кнопка «Ограничения: нет», свёрнута, галок в DOM нет", async () => {
    const el = await mount([emp(1, "Аня")]);
    const btn = toggleOf(el, 1);
    expect(btn.type).toBe("button");
    expect(btn.textContent).toContain("Ограничения: нет");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(boxes(el, 1)).toHaveLength(0);
  });

  it.each(COMBOS)("сводка свёрнутой карточки: %s", async (_name, over) => {
    const employee = emp(1, "Игорь", over);
    const el = await mount([employee]);
    const expected = restrictionsSummary(employee);
    expect(expected).not.toBe("нет");
    expect(toggleOf(el, 1).textContent).toContain(`Ограничения: ${expected}`);
  });

  it("раскрытие: три галки с прежними подписями и пояснениями", async () => {
    const el = await mount([emp(1, "Аня")]);
    await expand(el, 1);
    expect(toggleOf(el, 1).getAttribute("aria-expanded")).toBe("true");
    expect(boxes(el, 1)).toHaveLength(3);
    const text = card(el, 1).textContent ?? "";
    for (const part of [
      "Наблюдатель", "смотрит график, ведёт свой, шлёт анонсы. Вне раздачи, обменов и передачи смен",
      "Не участвует в назначениях", "бот не зовёт его на работу в выходные и не подсказывает его в очереди дежурств; вручную поставить можно",
      "Не участвует в обменах", "ни предложить, ни принять обмен; открытые заявки будут отменены",
    ]) expect(text).toContain(part);
  });

  it("у наблюдателя две нижние галки недоступны и показывают значение из базы", async () => {
    const el = await mount([emp(1, "Марк", { isObserver: true, excludedFromAssignment: true, excludedFromSwaps: false })]);
    await expand(el, 1);
    const [observer, assignment, swaps] = boxes(el, 1);
    expect(observer.checked).toBe(true);
    expect(observer.disabled).toBe(false);
    expect(assignment.disabled).toBe(true);
    expect(assignment.checked).toBe(true);
    expect(swaps.disabled).toBe(true);
    expect(swaps.checked).toBe(false);
    expect(card(el, 1).textContent).toContain("управляется ролью «Наблюдатель»");
  });

  it("переключение зовёт те же методы API, а сводка свёрнутой карточки меняется", async () => {
    const save = vi.spyOn(apiClient, "setEmployeeRestrictions").mockResolvedValue(undefined);
    const observer = vi.spyOn(apiClient, "setEmployeeObserver").mockResolvedValue(undefined);
    const el = await mount([emp(1, "Аня")]);
    await expand(el, 1);

    await act(async () => boxes(el, 1)[2].click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, { excludedFromSwaps: true });

    await act(async () => boxes(el, 1)[0].click());
    await settle();
    expect(observer).toHaveBeenCalledWith(1, true);

    // раскрытие переживает перерисовку после сохранения
    expect(toggleOf(el, 1).getAttribute("aria-expanded")).toBe("true");
    await expand(el, 1);
    expect(toggleOf(el, 1).textContent).toContain("Ограничения: наблюдатель, без обменов");
    expect(boxes(el, 1)).toHaveLength(0);
  });

  it("отказ API виден и в свёрнутом виде — вне свёрнутого блока", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount([emp(1, "Аня")]);
    await expand(el, 1);
    await act(async () => boxes(el, 1)[2].click());
    await settle();
    await expand(el, 1);

    expect(boxes(el, 1)).toHaveLength(0);
    const alert = card(el, 1).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("сеть недоступна");
  });
});
