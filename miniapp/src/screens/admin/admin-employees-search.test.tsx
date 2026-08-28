// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/**
 * Поиск в «Работниках» (мини-апп).
 *
 * Зеркало консольного `admin/src/screens/employees-search.test.tsx`, но с двумя
 * тестами, которых там нет, потому что до этой правки консоль и мини-апп вели
 * себя по-разному (находка ревью):
 *
 * - консоль считает порог показа поля от ПОЛНОГО ростера (активные + архив),
 *   мини-апп считал только от активных — поле пропадало там, где в консоли
 *   оставалось, стоило разделить один и тот же десяток людей на активных и
 *   архив;
 * - консоль фильтрует и раскрытый архив, мини-апп архив не фильтровал вовсе.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, isActive = true): Employee => ({
  id, displayName, isAdmin: false, isActive, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
});

// Четверо активных (порог — «больше пяти») плюс двое в архиве: порознь ни
// одна группа не переваливает за порог, а вместе — переваливает. Ровно тот
// расклад, на котором старый мини-апп ошибался, а консоль — нет.
const FOUR_ACTIVE_TWO_ARCHIVED: Employee[] = [
  person(1, "Иванова Анна"),
  person(2, "Петров Игорь"),
  person(3, "Семёнов Марк"),
  person(4, "Соколова Вера"),
  person(5, "Кузнецов Пётр", false),
  person(6, "Волкова Настя", false),
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

async function mountWith(employees: Employee[]) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue(employees);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, null)));
  });
  await settle();
  return host;
}

function searchField(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Кнопка «Показать · N» / «Свернуть» у `CollapsibleArchive` — своего класса
 *  у неё, в отличие от консоли, нет, поэтому ищем по тексту. */
function archiveToggle(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").match(/^(Показать|Свернуть)/));
  if (!found) throw new Error("кнопки архива нет на экране");
  return found as HTMLButtonElement;
}

/** Текст каждой карточки работника на экране (архив не раскрыт — значит,
 *  это только активные). */
function cardTexts(el: HTMLElement): string[] {
  return [...el.querySelectorAll("[data-employee-id]")].map((card) => card.textContent ?? "");
}

describe("поиск работника в мини-аппе", () => {
  it("прячет несовпавшие строки активных", async () => {
    const el = await mountWith(FOUR_ACTIVE_TWO_ARCHIVED);
    const field = searchField(el)!;
    await typeSearch(field, "семён");
    expect(cardTexts(el).some((n) => n.includes("Семёнов Марк"))).toBe(true);
    expect(cardTexts(el).some((n) => n.includes("Иванова Анна"))).toBe(false);
  });

  it("поле поиска показывается по порогу от полного ростера — активных четверо, но с архивом их шестеро", async () => {
    // Регресс: раньше порог считался от `active.length` (4 — не больше пяти,
    // поле не показывалось бы). Полный ростер (6) порог переваливает.
    const el = await mountWith(FOUR_ACTIVE_TWO_ARCHIVED);
    expect(searchField(el)).not.toBeNull();
  });

  it("поиск действует и в раскрытом архиве", async () => {
    const el = await mountWith(FOUR_ACTIVE_TWO_ARCHIVED);
    await act(async () => archiveToggle(el).click());
    await typeSearch(searchField(el)!, "волк");

    const archiveRows = [...el.querySelectorAll('[data-employee-id]')].filter((card) =>
      (card.textContent ?? "").includes("Вернуть"),
    );
    expect(archiveRows).toHaveLength(1);
    expect(archiveRows[0]!.textContent ?? "").toContain("Волкова Настя");
  });

  it("поиск без совпадений говорит «Никого с таким именем нет.», а не что ростер пуст", async () => {
    const el = await mountWith(FOUR_ACTIVE_TWO_ARCHIVED);
    await typeSearch(searchField(el)!, "нет такого");
    expect(el.textContent ?? "").toContain("Никого с таким именем нет.");
    expect(el.textContent ?? "").not.toContain("Пока нет активных работников");
  });
});
