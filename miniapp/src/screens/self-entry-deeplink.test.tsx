// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Shift } from "../api/client";
import { App } from "../App";

/**
 * Кнопки «🤒 Больничный» и «📌 Мероприятие» в боте ведут в мини-апп со строкой
 * запроса `?screen=sick|event` — и это единственное, что открывает форму сразу.
 * Разбор строки проверен отдельно (`self-entry.test.ts`), но проверка чистой
 * функции ничего не говорит про то, ЗОВЁТ ли её приложение: кнопка, ведущая в
 * список смен вместо формы, выглядела бы работающей ссылкой.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const MY_SICK_LEAVE = {
  id: 8080,
  date: daysFromNow(0),
  endDate: daysFromNow(2),
  start: null,
  end: null,
  category: "sick_leave",
  title: null,
  templateId: null,
  employeeId: 1,
  location: null,
  unrecognisedCode: null,
} as unknown as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(apiClient, "getMyShifts").mockResolvedValue({ shifts: [MY_SICK_LEAVE], today: daysFromNow(0) });
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [], shifts: [] });
  vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendOffers").mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

/** Моки отвечают через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mountAt(search: string) {
  window.history.replaceState({}, "", `/${search}`);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

describe("вход в самозапись по ссылке из бота", () => {
  it("?screen=event открывает форму мероприятия, а не список смен", async () => {
    const el = await mountAt("?screen=event");
    const text = el.textContent ?? "";
    expect(text).toContain("Название");
    expect(text).toContain("Записать мероприятие");
    // Это оверлей, а не вкладка: приветствие «Моих смен» под ним не рисуется.
    // Маркер — именно приветствие: строка про остаток недели у человека без смен
    // не рисуется и без всякого оверлея, и проверка на неё была бы пустой.
    expect(text).not.toContain("Привет");
  });

  it("?screen=sick открывает форму больничного и показывает уже стоящую запись", async () => {
    const el = await mountAt("?screen=sick");
    const text = el.textContent ?? "";
    expect(text).toContain("Поставить больничный");
    // Идущий больничный ещё можно продлить или снять — значит он в списке.
    expect(text).toContain("Снять");
    // У больничного нет времени, и полей мероприятия в этой форме быть не должно.
    expect(text).not.toContain("Место (необязательно)");
  });

  it("без строки запроса мини-апп открывается как раньше — на «Моих сменах»", async () => {
    const el = await mountAt("");
    expect(el.textContent ?? "").toContain("Привет");
  });
});
