// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Две галки ограничений на карточке работника.
 *
 * Второй тест здесь — про дефект, пойманный в этом проекте дважды: управляемый
 * элемент откатывается после УСПЕШНОГО сохранения, потому что экран рисует не
 * свой ответ, а те же данные, что были. На скриншоте это не видно вообще —
 * ловится только DOM-тестом.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: true, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false, remindersEnabled: true },
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

/**
 * Stands in for `App.tsx`: `EmployeesScreen` no longer keeps its own copy of
 * the restriction flags, so a save has to reach a real state update to show
 * up at all — this mirrors `App`'s `patchEmployeeRestrictions`, wired the
 * same way (`onRestrictionsSaved` patches state; `onChanged` stays a no-op,
 * as the real re-fetch would be for an unrelated action in these tests).
 */
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

/** Чекбокс по подписи рядом с ним, в карточке нужного работника. */
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

describe("галки ограничений на карточке работника", () => {
  it("рисует обе галки в том состоянии, которое пришло с сервера", async () => {
    const el = await mount();
    expect(checkboxIn(el, 1, "Не участвует в назначениях").checked).toBe(false);
    expect(checkboxIn(el, 2, "Не участвует в назначениях").checked).toBe(true);
    expect(checkboxIn(el, 2, "Не участвует в обменах").checked).toBe(false);
  });

  it("после успешного сохранения галка остаётся в новом положении", async () => {
    const save = vi.spyOn(apiClient, "setEmployeeRestrictions").mockResolvedValue(undefined);
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    expect(save).toHaveBeenCalledWith(1, { excludedFromSwaps: true });
    // До починки здесь было false: сервер сохранил, экран об этом не узнал.
    expect(checkboxIn(el, 1, "Не участвует в обменах").checked).toBe(true);
  });

  it("отказ возвращает галку и пишет причину в карточке этого работника", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    expect(checkboxIn(el, 1, "Не участвует в обменах").checked).toBe(false);
    const card = el.querySelector('[data-employee-id="1"]')!;
    expect(card.textContent ?? "").toContain("сеть недоступна");
  });

  it("ошибка одного работника не появляется у соседнего и не убирает его со списка", async () => {
    vi.spyOn(apiClient, "setEmployeeRestrictions").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Не участвует в обменах"));

    const neighbour = el.querySelector('[data-employee-id="2"]')!;
    expect(neighbour.textContent ?? "").not.toContain("сеть недоступна");
    expect(checkboxIn(el, 2, "Не участвует в назначениях")).toBeTruthy();
  });
});
