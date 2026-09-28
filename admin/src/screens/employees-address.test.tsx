// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * «Обращение» в карточке работника консоли — как в мини-аппе.
 *
 * Бот зовёт человека не по ФИО, а по обращению (`addressOf`), и угадать его по
 * имени нельзя: «Иванова Анна» может быть «Нютой». Админ, который правит ростер
 * в консоли, должен видеть, как бот обратится к человеку, и поправить это там
 * же, а не идти за телефоном.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
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

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

function Harness({ initial, onChanged }: { initial: Employee[]; onChanged: () => Promise<void> }) {
  const [employees] = useState(initial);
  return createElement(EmployeesScreen, {
    employees,
    onChanged,
    onRestrictionsSaved: () => {},
    onObserverSaved: () => {},
  });
}

async function mountWith(initial: Employee[], onChanged: () => Promise<void> = async () => {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness, { initial, onChanged })); });
  await settle();
  return host;
}

function rowOf(el: HTMLElement, id: number): HTMLElement {
  const row = el.querySelector<HTMLElement>(`[data-employee-id="${id}"]`);
  if (!row) throw new Error(`нет строки работника ${id}`);
  return row;
}

function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("«Работники» консоли: обращение", () => {
  it("карточка говорит, как бот зовёт человека", async () => {
    const el = await mountWith([person(1, "Иванова Анна", { preferredName: "Нюта", address: "Нюта" })]);
    expect(rowOf(el, 1).textContent).toContain("Бот зовёт: Нюта");
  });

  it("«✎ Обращение» сохраняет набранное — тем же id", async () => {
    const save = vi.spyOn(apiClient, "setEmployeePreferredName").mockResolvedValue();
    const onChanged = vi.fn(async () => {});
    const el = await mountWith([person(1, "Иванова Анна"), person(2, "Смирнов Игорь")], onChanged);

    await act(async () => buttonWith(rowOf(el, 2), "✎ Обращение").click());
    const input = rowOf(el, 2).querySelector<HTMLInputElement>("input[aria-label='Обращение']")!;
    // Пустое поле показывает, как бот зовёт сейчас: админ видит, что меняет.
    expect(input.placeholder).toBe("Игорь");
    await typeInto(input, "  Гоша ");
    await act(async () => buttonWith(rowOf(el, 2), "Сохранить").click());
    await settle();

    expect(save).toHaveBeenCalledWith(2, "Гоша");
    expect(onChanged).toHaveBeenCalled();
  });

  it("стёртое обращение уходит как null — бот вернётся к имени по умолчанию", async () => {
    const save = vi.spyOn(apiClient, "setEmployeePreferredName").mockResolvedValue();
    const el = await mountWith([person(1, "Иванова Анна", { preferredName: "Нюта", address: "Нюта" })]);

    await act(async () => buttonWith(rowOf(el, 1), "✎ Обращение").click());
    await typeInto(rowOf(el, 1).querySelector<HTMLInputElement>("input[aria-label='Обращение']")!, "   ");
    await act(async () => buttonWith(rowOf(el, 1), "Сохранить").click());
    await settle();

    expect(save).toHaveBeenCalledWith(1, null);
  });

  it("то же обращение не шлётся — нечего писать в журнал", async () => {
    const save = vi.spyOn(apiClient, "setEmployeePreferredName").mockResolvedValue();
    const el = await mountWith([person(1, "Иванова Анна", { preferredName: "Нюта", address: "Нюта" })]);

    await act(async () => buttonWith(rowOf(el, 1), "✎ Обращение").click());
    await act(async () => buttonWith(rowOf(el, 1), "Сохранить").click());
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(rowOf(el, 1).textContent).toContain("Бот зовёт: Нюта");
  });

  it("отказ сервера виден в строке этого человека", async () => {
    vi.spyOn(apiClient, "setEmployeePreferredName").mockRejectedValue(new Error("Обращение длиннее 40 символов"));
    const el = await mountWith([person(1, "Иванова Анна")]);

    await act(async () => buttonWith(rowOf(el, 1), "✎ Обращение").click());
    await typeInto(rowOf(el, 1).querySelector<HTMLInputElement>("input[aria-label='Обращение']")!, "Аня");
    await act(async () => buttonWith(rowOf(el, 1), "Сохранить").click());
    await settle();

    expect(rowOf(el, 1).textContent).toContain("Обращение длиннее 40 символов");
  });

  it("у архивного тоже можно поправить обращение", async () => {
    const save = vi.spyOn(apiClient, "setEmployeePreferredName").mockResolvedValue();
    const el = await mountWith([person(1, "Иванова Анна"), person(3, "Орлов Марк", { isActive: false })]);
    await act(async () => el.querySelector<HTMLButtonElement>(".archive-toggle")!.click());
    await settle(2);

    await act(async () => buttonWith(rowOf(el, 3), "✎ Обращение").click());
    await typeInto(rowOf(el, 3).querySelector<HTMLInputElement>("input[aria-label='Обращение']")!, "Марик");
    await act(async () => buttonWith(rowOf(el, 3), "Сохранить").click());
    await settle();

    expect(save).toHaveBeenCalledWith(3, "Марик");
  });
});
