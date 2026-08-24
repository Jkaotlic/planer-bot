// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Employee } from "../../api/client";
import { AdminShiftKinds } from "./AdminShiftKinds";

/**
 * Зеркало консольного `admin/src/screens/shift-kinds-search.test.tsx`: пустой
 * результат поиска должен сказать «Никого с таким именем нет.», а не молча
 * нарисовать список без единой строки.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ")[0]!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false,
});

// Шестеро — больше порога показа поля поиска (5), как в консольном зеркале.
const EMPLOYEES: Employee[] = [
  person(1, "Аня Смирнова"),
  person(2, "Игорь Петров"),
  person(3, "Марк Волков"),
  person(4, "Вера Соколова"),
  person(5, "Пётр Кузнецов"),
  person(6, "Ника Орлова"),
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
    root!.render(
      createElement(AppRoot, null, createElement(AdminShiftKinds, { employees: EMPLOYEES, onClose: () => {} })),
    );
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
  await settle(2);
}

describe("поиск в «Кто что может» (мини-апп)", () => {
  it("поиск без совпадений говорит «Никого с таким именем нет.», а не рисует пустую матрицу молча", async () => {
    const el = await mount();
    await typeSearch(searchField(el), "нет такого человека");

    expect(el.textContent ?? "").toContain("Никого с таким именем нет.");
  });
});
