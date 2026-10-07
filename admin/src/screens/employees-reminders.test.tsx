// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Employee } from "../api/client";
import { TeamTzContext } from "../lib/team-today";
import { EmployeesScreen } from "./EmployeesScreen";

/**
 * Видно ли админу, что до человека не доходят сообщения бота.
 *
 * 2026-08-28: трое отписались от напоминаний (одним тапом по 🔕 под сообщением
 * бота), и месяцами не получали ничего. В консоли они выглядели обычными
 * работниками — понять это удалось только запросом к живой базе. Метка в
 * карточке существует ровно затем, чтобы такого расследования больше не
 * понадобилось.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
});

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

function Harness({ initial, tz }: { initial: Employee[]; tz?: string }) {
  const [employees] = useState(initial);
  return createElement(TeamTzContext.Provider, { value: tz }, createElement(EmployeesScreen, {
    employees,
    onChanged: async () => {},
    onRestrictionsSaved: () => {},
    onObserverSaved: () => {},
  }));
}

async function mountWith(initial: Employee[], tz?: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness, { initial, tz })); });
  await settle();
  return host;
}

/** Карточка одного человека — метку ищем в его строке, а не по всему экрану. */
function rowOf(el: HTMLElement, id: number): HTMLElement {
  const row = el.querySelector<HTMLElement>(`[data-employee-id="${id}"]`);
  if (!row) throw new Error(`нет строки работника ${id}`);
  return row;
}

describe("«Работники»: видно, доходят ли сообщения", () => {
  it("у отписавшегося от напоминаний стоит метка", async () => {
    const el = await mountWith([person(1, "Аня"), person(2, "Игорь", { remindersEnabled: false })]);
    expect(rowOf(el, 2).textContent).toContain("напоминания выключены");
  });

  it("у остальных этой метки нет — она про исключение, а не про норму", async () => {
    const el = await mountWith([person(1, "Аня"), person(2, "Игорь", { remindersEnabled: false })]);
    expect(rowOf(el, 1).textContent).not.toContain("напоминания выключены");
  });

  // Непривязанный не получает вообще ничего, и это отдельная беда: метка
  // «напоминания выключены» о ней не скажет, а «не привязан» уже есть.
  it("непривязанному метка не приписывается", async () => {
    const el = await mountWith([person(3, "Марк", { telegramUserId: null })]);
    expect(rowOf(el, 3).textContent).toContain("не привязан");
    expect(rowOf(el, 3).textContent).not.toContain("напоминания выключены");
  });
});

describe("«Работники»: заблокировал бота", () => {
  // Заблокировавший везде считался достижимым: ему «уходили» напоминания,
  // обмены и объявления, а админ не мог этого увидеть.
  it("у заблокировавшего — метка с датой", async () => {
    const el = await mountWith([person(1, "Аня"), person(2, "Игорь", { botBlockedAt: "2026-09-12T10:00:00.000Z" })]);
    expect(rowOf(el, 2).textContent).toContain("заблокировал бота");
    expect(rowOf(el, 1).textContent).not.toContain("заблокировал бота");
  });

  // Дата метки — по поясу команды, а не машины админа. Гавайи выбраны нарочно: машина
  // тестов в Москве, и без пояса вышло бы 12.09.
  it("день метки считается по поясу команды", async () => {
    const el = await mountWith([person(2, "Игорь", { botBlockedAt: "2026-09-11T22:30:00.000Z" })], "Pacific/Honolulu");
    expect(rowOf(el, 2).textContent).toContain("заблокировал бота с 11.09");
  });
});
