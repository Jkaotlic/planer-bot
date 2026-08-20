// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { ShiftKindsScreen } from "./ShiftKindsScreen";

/**
 * Зеркало теста мини-аппа (`miniapp/src/screens/admin/shift-kinds-rotation.test.tsx`) —
 * тот же дефект жил в обоих экранах одинаково.
 *
 * Селект «Очередь идёт» управляемый и берёт значение только из `queue`, которая
 * перечитывалась лишь при открытии карточки. Сохранение проходило, состояние
 * экрана не менялось, и React возвращал селекту прежнее значение: выбрал
 * «по неделям» — прыгнуло обратно на «по дням».
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES: Employee[] = [
  { id: 1, displayName: "Аня Смирнова", isAdmin: false, isActive: true, telegramUserId: 10, birthDate: null, preferredName: null, address: "Аня", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 11, birthDate: null, preferredName: null, address: "Игорь", excludedFromAssignment: false, excludedFromSwaps: false, isObserver: false, selfScheduleEnabled: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ShiftKindsScreen, { employees: EMPLOYEES }));
  });
  await settle();
  return host;
}

function rotationSelect(el: HTMLElement): HTMLSelectElement {
  const select = el.querySelector("select");
  if (!select) throw new Error("селекта «Очередь идёт» нет на экране");
  return select as HTMLSelectElement;
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("«Очередь идёт» в консоли — выбранная единица остаётся выбранной", () => {
  it("после выбора «по неделям» селект показывает «по неделям», а не откатывается", async () => {
    const el = await mount();
    const head = el.querySelector("button[aria-expanded]") as HTMLButtonElement;
    await act(async () => head.click());
    await settle();

    const select = rotationSelect(el);
    expect(select.value).toBe("day");

    await choose(select, "week");

    // До починки здесь было "day": сервер сохранил, экран об этом не узнал.
    expect(rotationSelect(el).value).toBe("week");
  });
});
