// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Чип «Не слышат бота: N» над списком работников.
 *
 * Метки «не привязан» и «🚫 заблокировал бота» стоят в карточках, но при
 * ростере в тридцать строк их не собрать глазами — админ узнаёт, что
 * человек не получил опрос, когда тот уже не ответил. Чип считает их разом
 * и по нажатию оставляет в списке только их.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
});

// Аня без Telegram, Игорь заблокировал, Марк и Вера слышат. Тимур в архиве и
// без Telegram — он не должен попасть в счёт.
const TEAM: Employee[] = [
  person(1, "Иванова Аня", { telegramUserId: null }),
  person(2, "Петров Игорь", { botBlockedAt: "2026-10-12T09:00:00.000Z" }),
  person(3, "Семёнов Марк"),
  person(4, "Соколова Вера"),
  person(5, "Кузнецов Пётр"),
  person(6, "Орлова Ника"),
  person(7, "Дубов Тимур", { isActive: false, telegramUserId: null }),
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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

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
  await act(async () => { root!.render(createElement(Harness, { initial })); });
  await settle();
  return host;
}

function chip(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>("button.cannot-hear-chip");
}

async function click(button: HTMLElement) {
  await act(async () => { button.click(); });
}

/** Только строки секции «Активные»: архив свёрнут, но проверять это лишний раз незачем. */
function activeNames(el: HTMLElement): string[] {
  const section = el.querySelector(".employees-section");
  return [...(section?.querySelectorAll(".employee-row-name") ?? [])].map((n) => (n.textContent ?? "").trim());
}

async function typeSearch(el: HTMLElement, value: string) {
  const field = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("«Работники»: чип «Не слышат бота»", () => {
  it("считает активных без Telegram и заблокировавших, архив — нет", async () => {
    const el = await mountWith(TEAM);
    expect(chip(el)?.textContent).toBe("Не слышат бота: 2");
  });

  it("когда таких нет, чипа нет вовсе", async () => {
    const el = await mountWith(TEAM.filter((e) => e.id >= 3));
    expect(chip(el)).toBeNull();
  });

  it("нажатие оставляет в «Активных» только их, повторное — снимает фильтр", async () => {
    const el = await mountWith(TEAM);
    await click(chip(el)!);
    expect(activeNames(el)).toEqual(["Иванова Аня", "Петров Игорь"]);
    expect(chip(el)?.getAttribute("aria-pressed")).toBe("true");
    await click(chip(el)!);
    expect(activeNames(el)).toHaveLength(6);
    expect(chip(el)?.getAttribute("aria-pressed")).toBe("false");
  });

  it("фильтр складывается с поиском, а счёт от поиска не зависит", async () => {
    const el = await mountWith(TEAM);
    await click(chip(el)!);
    await typeSearch(el, "игорь");
    expect(activeNames(el)).toEqual(["Петров Игорь"]);
    // Счёт — про команду, а не про найденное: иначе число прыгало бы под пальцами.
    expect(chip(el)?.textContent).toBe("Не слышат бота: 2");
  });
});
