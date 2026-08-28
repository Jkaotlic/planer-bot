// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Переключатель «Наблюдатель» на десктопной карточке работника.
 *
 * Ревью финальной ветки нашло: мини-апповая версия (`AdminEmployeesScreen`)
 * уже гасит и подписывает обе галки-ограничения под ролью, а десктопная
 * консоль о роли молчала вовсе — переключателя не было, и обе галки
 * рисовались активными и кликабельными для наблюдателя, хотя их значение
 * ничего не решает, пока роль стоит. Тест ловит именно это расхождение, а не
 * только наличие нового чекбокса.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: false, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: true, selfScheduleEnabled: true, remindersEnabled: true },
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

/** Stands in for `App.tsx` — see employees-restrictions.test.tsx's Harness for why. */
function Harness({ initial }: { initial: Employee[] }) {
  const [employees, setEmployees] = useState(initial);
  return createElement(EmployeesScreen, {
    employees,
    onChanged: async () => {},
    onRestrictionsSaved: (id, patch) => setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    onObserverSaved: (id, isObserver) => setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, isObserver } : e))),
  });
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Harness, { initial: EMPLOYEES }));
  });
  await settle();
  return host;
}

function checkboxIn(el: HTMLElement, employeeId: number, label: string): HTMLInputElement {
  const card = el.querySelector(`[data-employee-id="${employeeId}"]`);
  if (!card) throw new Error(`нет карточки работника #${employeeId}`);
  const found = [...card.querySelectorAll("label")]
    .find((l) => (l.textContent ?? "").includes(label))
    ?.querySelector("input[type=checkbox]");
  if (!found) throw new Error(`нет галки «${label}» у работника #${employeeId}`);
  return found as HTMLInputElement;
}

async function toggle(box: HTMLInputElement) {
  await act(async () => box.click());
  await settle();
}

describe("переключатель «Наблюдатель» на карточке работника", () => {
  it("рисует роль в том состоянии, которое пришло с сервера", async () => {
    const el = await mount();
    expect(checkboxIn(el, 1, "Наблюдатель").checked).toBe(false);
    expect(checkboxIn(el, 2, "Наблюдатель").checked).toBe(true);
  });

  it("включение роли зовёт setEmployeeObserver и остаётся включённым после успеха", async () => {
    const save = vi.spyOn(apiClient, "setEmployeeObserver").mockResolvedValue(undefined);
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Наблюдатель"));

    expect(save).toHaveBeenCalledWith(1, true);
    expect(checkboxIn(el, 1, "Наблюдатель").checked).toBe(true);
  });

  it("у наблюдателя обе галки-ограничения выключены и подписаны ролью", async () => {
    const el = await mount();
    const assignment = checkboxIn(el, 2, "Не участвует в назначениях");
    const swaps = checkboxIn(el, 2, "Не участвует в обменах");
    expect(assignment.disabled).toBe(true);
    expect(swaps.disabled).toBe(true);
    const card = el.querySelector('[data-employee-id="2"]')!;
    expect(card.textContent ?? "").toContain("управляется ролью «Наблюдатель»");
  });

  it("у обычного работника обе галки-ограничения кликабельны как раньше", async () => {
    const el = await mount();
    const assignment = checkboxIn(el, 1, "Не участвует в назначениях");
    const swaps = checkboxIn(el, 1, "Не участвует в обменах");
    expect(assignment.disabled).toBe(false);
    expect(swaps.disabled).toBe(false);
  });
});
