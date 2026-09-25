// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Shift } from "../api/client";
import { App } from "../App";

/**
 * Тап по своей смене должен спросить сервер за ровно тот день, что открыли —
 * не за неделю и не за «предыдущий» день, оставшийся от прошлого тапа. А тап
 * по «Обменять» на ДРУГОЙ смене обязан переключить загрузку на день обмена, а
 * не застрять на дне, который был открыт до этого («сбросить открытый лист»).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Заведомо вне текущей недели, в какой бы день тест ни запускали — тот же
 *  приём, что в `propose-swap-day.test.tsx`. */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAY_A = daysFromNow(21);
const DAY_B = daysFromNow(28);

const MY_SHIFT_A = {
  id: 4242, date: DAY_A, endDate: null, start: "10:00", end: "19:00",
  category: "shift", title: "День", templateId: 2, employeeId: 1,
  location: null, note: null, unrecognisedCode: null,
} as unknown as Shift;

const MY_SHIFT_B = {
  id: 4243, date: DAY_B, endDate: null, start: "09:00", end: "18:00",
  category: "shift", title: "День", templateId: 2, employeeId: 1,
  location: null, note: null, unrecognisedCode: null,
} as unknown as Shift;

const IGOR_ON_A = {
  id: 5001, date: DAY_A, endDate: null, start: "09:00", end: "18:00",
  category: "shift", title: null, templateId: 2, employeeId: 8, employeeName: "Игорь",
  location: null, note: null, unrecognisedCode: null,
} as unknown as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const asked: { from: string; to: string }[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.spyOn(apiClient, "getMyShifts").mockResolvedValue({ shifts: [MY_SHIFT_A, MY_SHIFT_B], today: daysFromNow(0) });
  vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(async (from: string, to: string) => {
    asked.push({ from, to });
    if (from === DAY_A && to === DAY_A) {
      return { employees: [], shifts: [IGOR_ON_A], calendar: [] };
    }
    return { employees: [], shifts: [], calendar: [] };
  });
  vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWeekendOffers").mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 30) {
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
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

function shiftRows(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[data-testid="shift-row"]')];
}

function swapButtonIn(row: HTMLElement): HTMLElement {
  const found = [...row.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Обменять");
  if (!found) throw new Error("кнопки «Обменять» в этой строке нет");
  return found;
}

describe("тап по своей смене грузит ровно этот день, «Обменять» на другом дне сбрасывает лист", () => {
  it("тап открывает лист и спрашивает сервер за (date, date)", async () => {
    const el = await mount();
    const rows = shiftRows(el);
    expect(rows.length).toBe(2);

    // Строки отсортированы по дате (`groupUpcomingByWeek`) — первая своя смена
    // (DAY_A) раньше второй (DAY_B).
    await act(async () => rows[0]!.click());
    await settle();

    expect(asked).toContainEqual({ from: DAY_A, to: DAY_A });
    expect(el.textContent).toContain("Игорь · 09:00–18:00");
  });

  it("«Обменять» на другом дне переключает загрузку на день обмена", async () => {
    const el = await mount();
    const rows = shiftRows(el);

    // Открываем лист коллег для DAY_A.
    await act(async () => rows[0]!.click());
    await settle();
    expect(asked).toContainEqual({ from: DAY_A, to: DAY_A });

    // «Обменять» — на ВТОРОЙ смене, другой день (DAY_B). Открытый лист DAY_A
    // не должен держать загрузку на своём дне.
    await act(async () => swapButtonIn(rows[1]!).click());
    await settle();

    expect(asked.at(-1)).toEqual({ from: DAY_B, to: DAY_B });
    expect(el.textContent).toContain("Предложить обмен");
  });
});
