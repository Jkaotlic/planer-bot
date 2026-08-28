// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { ShiftKindsScreen } from "./ShiftKindsScreen";

/**
 * Поиск на экране «Виды смен» ищет ЛЮДЕЙ и ничего больше.
 *
 * Сводка допусков у найденного человека считается по всем видам смен, а не по
 * тому, что набрано в поиске: иначе «допущен ко всем (9)» тихо превращалось бы
 * в «допущен ко всем (1)», и ни один сигнал в интерфейсе об этом не сказал бы.
 * Карточек видов смен сверху поиск не касается вовсе.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
});

const SIX_PEOPLE: Employee[] = [
  person(1, "Иванова Анна"),
  person(2, "Петров Игорь"),
  person(3, "Семёнов Марк"),
  person(4, "Соколова Вера"),
  person(5, "Кузнецов Пётр"),
  person(6, "Орлова Ника"),
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
    root!.render(createElement(ShiftKindsScreen, { employees: SIX_PEOPLE }));
  });
  await settle();
  return host;
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("поиск в «Кто что может» (консоль)", () => {
  it("сужает список людей, не трогая их сводку допусков", async () => {
    const el = await mount();

    await typeSearch(searchField(el), "семён");
    await settle();

    // Карточки видов смен сверху поиском не задеты — он про людей.
    const people = [...el.querySelectorAll(".kind-card-head")].filter((head) =>
      (head.textContent ?? "").includes("Семёнов Марк"),
    );
    expect(people).toHaveLength(1);
    // Сводка считается по всем видам смен, а не по тому, что набрано в поиске.
    expect(people[0]!.textContent ?? "").toContain("допущен");
  });

  it("поиск без совпадений говорит «Никого с таким именем нет.», а не рисует пустой список молча", async () => {
    const el = await mount();

    await typeSearch(searchField(el), "нет такого человека");
    await settle();

    expect(el.textContent ?? "").toContain("Никого с таким именем нет.");
  });
});
