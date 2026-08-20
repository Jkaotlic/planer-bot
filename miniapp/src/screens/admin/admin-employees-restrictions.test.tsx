// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/**
 * Зеркало теста десктопа (`admin/src/screens/employees-restrictions.test.tsx`):
 * две галки ограничений на карточке работника.
 *
 * Второй тест здесь — про дефект, пойманный в этом проекте дважды: управляемый
 * элемент откатывается после УСПЕШНОГО сохранения, потому что экран рисует не
 * свой ответ, а те же данные, что были. На скриншоте это не видно вообще —
 * ловится только DOM-тестом. В мини-аппе это особенно опасно: экран сам держит
 * свой список работников и сам его перечитывает после каждого действия.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: true, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: true, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
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

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  // AdminEmployeesScreen не принимает список пропом — сам зовёт getAdminEmployees.
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue(EMPLOYEES);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null)));
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

describe("галки ограничений на карточке работника (мини-апп)", () => {
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
    // До починки здесь было false: сервер сохранил, экран об этом не узнал —
    // тот же дефект, что чинили дважды, теперь пойман DOM-тестом заранее.
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

/**
 * Тумблер «Наблюдатель» — Задача 8.
 *
 * Осознанное решение из брифа: у наблюдателя две галки ограничений ниже
 * рисуются `disabled` и значением ИЗ БАЗЫ, а не эффективным («и так вне
 * назначений из-за роли»). Админ должен видеть, куда человек вернётся, когда
 * роль снимут — не то, что происходит с ним сейчас.
 */
describe("тумблер «Наблюдатель» на карточке работника (мини-апп)", () => {
  it("после включения тумблер остаётся включённым (тот же дефект, что и у ограничений)", async () => {
    const save = vi.spyOn(apiClient, "setEmployeeObserver").mockResolvedValue(undefined);
    const el = await mount();

    await toggle(checkboxIn(el, 1, "Наблюдатель"));

    expect(save).toHaveBeenCalledWith(1, true);
    expect(checkboxIn(el, 1, "Наблюдатель").checked).toBe(true);
  });

  it("у наблюдателя обе галки ограничений выключены из ввода и показывают значение из базы", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([
      {
        id: 5, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: 15,
        birthDate: null, preferredName: null, address: "Марк",
        // В базе исключён из назначений ДО роли — при снятии роли он должен
        // остаться исключённым, поэтому галка обязана показывать `true`, а не
        // «участвует», хоть распределение и так его сейчас пропускает.
        excludedFromAssignment: true, excludedFromSwaps: false,
        isObserver: true, selfScheduleEnabled: false,
      },
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null)));
    });
    await settle();

    const assignment = checkboxIn(host, 5, "Не участвует в назначениях");
    const swaps = checkboxIn(host, 5, "Не участвует в обменах");
    expect(assignment.checked).toBe(true); // значение из базы, не эффективное
    expect(assignment.disabled).toBe(true);
    expect(swaps.checked).toBe(false);
    expect(swaps.disabled).toBe(true);
    expect(host.querySelector(`[data-employee-id="5"]`)!.textContent ?? "").toContain("управляется ролью");
  });
});
