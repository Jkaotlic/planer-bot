// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Поиск в «Работниках».
 *
 * Главная ловушка здесь — нумерация: `EmployeesSection` передаёт позицию как
 * `index + 1`, и если считать её по ОТФИЛЬТРОВАННОМУ массиву, «переставить на
 * позицию 2» после поиска переставит не туда, кого видно, а не того, кого
 * думает админ. Второй тест в этом файле ловит именно это.
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

// Седьмой — в архиве. Нужен только для теста «поиск не трогает архив»: с
// нулём архивных `CollapsibleArchive` не рисует секцию вовсе (пустая свёрнутая
// секция не рисуется совсем), и проверять там нечего.
const WITH_ARCHIVED: Employee[] = [...SIX_PEOPLE, { ...person(7, "Волкова Настя"), isActive: false }];

// Двое в архиве — нужен для теста «поиск действует и в раскрытом архиве»:
// один совпадает с запросом, второй нет, и разница видна только если их двое.
const WITH_TWO_ARCHIVED: Employee[] = [
  ...SIX_PEOPLE,
  { ...person(7, "Волкова Настя"), isActive: false },
  { ...person(8, "Дубов Тимур"), isActive: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

/** Stands in for `App.tsx` — see `employees-restrictions.test.tsx`'s `Harness`. */
function Harness({ initial }: { initial: Employee[] }) {
  const [employees] = useState(initial);
  return createElement(EmployeesScreen, {
    employees,
    onChanged: async () => {},
    onRestrictionsSaved: () => {},
    onObserverSaved: () => {},
  });
}

async function mountWith(initial: Employee[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Harness, { initial }));
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

function rowNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll(".employee-row-name")].map((n) => (n.textContent ?? "").trim());
}

describe("поиск работника в консоли", () => {
  it("прячет несовпавшие строки", async () => {
    const el = await mountWith(SIX_PEOPLE);
    await typeSearch(searchField(el), "семён");
    expect(rowNames(el)).toEqual(["Семёнов Марк"]);
  });

  it("поиск без совпадений говорит «Никого с таким именем нет.», а не что ростер пуст", async () => {
    // Ростер полон — пуст только РЕЗУЛЬТАТ поиска, и подпись не должна путать
    // одно с другим (иначе она соврёт про причину).
    const el = await mountWith(SIX_PEOPLE);
    await typeSearch(searchField(el), "нет такого");
    const empty = el.querySelector(".employees-empty");
    expect(empty?.textContent).toBe("Никого с таким именем нет.");
    expect(empty?.textContent).not.toContain("Пока нет активных работников");
  });

  it("позиция в списке считается от полного ростера, а не от найденного", async () => {
    const el = await mountWith(SIX_PEOPLE); // Семёнов — третий из шести
    await typeSearch(searchField(el), "семён");
    const position = el.querySelector<HTMLInputElement>(".employee-row-card input[aria-label='Номер в списке']")!;
    expect(position.value).toBe("3");
  });

  it("поиск не трогает архив: свернутая секция остаётся свернутой", async () => {
    const el = await mountWith(WITH_ARCHIVED);
    // Запрос находит ТОЛЬКО архивного человека («Волкова» не совпадает ни с
    // одним активным именем) — соблазн для наивной реализации: если бы поиск
    // заодно раскрывал архив, чтобы «дотянуться» до найденного, это было бы
    // видно здесь.
    await typeSearch(searchField(el), "волк");
    expect(rowNames(el)).toEqual([]);
    const toggle = el.querySelector<HTMLButtonElement>(".archive-toggle");
    if (!toggle) throw new Error("архив не нарисовался, хотя в списке есть архивный человек");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("поиск действует и в раскрытом архиве, но не в его счётчике", async () => {
    const el = await mountWith(WITH_TWO_ARCHIVED);
    const toggle = el.querySelector<HTMLButtonElement>(".archive-toggle")!;
    await act(async () => toggle.click());
    await typeSearch(searchField(el), "волк");
    // Строка — только совпавшая; заголовок архива остаётся «Архив · 2»: он
    // про факт наличия архивных людей, а не про то, что нашлось поиском.
    const archiveRows = [...el.querySelectorAll(".archive-toggle ~ .employees-list .employee-row-name")].map(
      (n) => (n.textContent ?? "").trim(),
    );
    expect(archiveRows).toEqual(["Волкова Настя"]);
    expect(toggle.textContent).toContain("Архив · 2");
  });
});
