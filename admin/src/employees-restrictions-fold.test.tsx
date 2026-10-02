// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// Ожидаемый текст — литералами, а не вызовом restrictionsSummary: иначе тест
// повторял бы компонент и не мог бы упасть ни на словах, ни на подмене значений.
const COMBOS: Array<[string, Partial<Employee>, string]> = [
  ["нет", {}, "нет"],
  ["наблюдатель", { isObserver: true }, "наблюдатель"],
  ["без назначений", { excludedFromAssignment: true }, "без назначений"],
  ["без обменов", { excludedFromSwaps: true }, "без обменов"],
  ["без назначений и обменов", { excludedFromAssignment: true, excludedFromSwaps: true }, "без назначений, без обменов"],
  ["наблюдатель и без назначений", { isObserver: true, excludedFromAssignment: true }, "наблюдатель, без назначений"],
  ["наблюдатель и без обменов", { isObserver: true, excludedFromSwaps: true }, "наблюдатель, без обменов"],
  ["все три", { isObserver: true, excludedFromAssignment: true, excludedFromSwaps: true }, "наблюдатель, без назначений, без обменов"],
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

  it.each(COMBOS)("сводка свёрнутой карточки: %s", async (_name, over, expected) => {
    const el = await mount([emp(1, "Игорь", over)]);
    expect(toggleOf(el, 1).textContent).toContain(`Ограничения: ${expected}`);
  });


  // Модификатор нужен CSS, чтобы строка с заданными ограничениями читалась заметнее «нет».
  it("модификатор «--set» стоит у ограниченного работника и не стоит у обычного", async () => {
    const el = await mount([emp(1, "Аня"), emp(2, "Игорь", { isObserver: true }), emp(3, "Марк", { excludedFromSwaps: true })]);
    expect(toggleOf(el, 1).classList.contains("employee-restrictions-toggle--set")).toBe(false);
    expect(toggleOf(el, 2).classList.contains("employee-restrictions-toggle--set")).toBe(true);
    expect(toggleOf(el, 3).classList.contains("employee-restrictions-toggle--set")).toBe(true);
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

  // Чекбокс «Не участвует в назначениях» у наблюдателя показывает хранимое значение,
  // а не «эффективное» (наблюдатель и так вне раздачи): иначе админ не увидит, что в базе.
  it.each([[false], [true]])("у наблюдателя галка назначений недоступна и показывает хранимое %s", async (stored) => {
    const el = await mount([emp(1, "Лена", { isObserver: true, excludedFromAssignment: stored })]);
    await expand(el, 1);
    const assignment = boxes(el, 1)[1];
    expect(assignment.disabled).toBe(true);
    expect(assignment.checked).toBe(stored);
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
