// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { ShiftKindsScreen } from "./ShiftKindsScreen";

/**
 * Поиск в «Видах смен» не должен подменять счётчик допусков в заголовке
 * карточки: `poolSummary` в `.kind-meta` считается от полного списка
 * работников, не от найденного — иначе «допущены: все (6)» тихо превратится
 * в «все (1)», стоило кому-то что-нибудь набрать в поиске, и ни один сигнал
 * в интерфейсе об этом не скажет.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false,
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

describe("поиск в «Видах смен» не подменяет счётчик допусков", () => {
  it("список сужается, а «допущены: …» в заголовке карточки остаётся как было", async () => {
    const el = await mount();

    const head = el.querySelector<HTMLButtonElement>(".kind-card-head");
    if (!head) throw new Error("карточки вида смены нет на экране");
    await act(async () => head.click());
    await settle();

    const meta = el.querySelector(".kind-meta");
    if (!meta) throw new Error("нет .kind-meta у раскрытой карточки");
    const metaBefore = (meta.textContent ?? "").trim();

    await typeSearch(searchField(el), "семён");

    const rows = [...el.querySelectorAll(".kind-person-name")];
    expect(rows).toHaveLength(1);
    expect((rows[0]!.textContent ?? "")).toContain("Семёнов Марк");

    // Суть теста: счётчик в заголовке не зависит от того, что набрано в поиске.
    expect((meta.textContent ?? "").trim()).toBe(metaBefore);
  });
});
