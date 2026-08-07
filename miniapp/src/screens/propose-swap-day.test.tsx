// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Shift } from "../api/client";
import { App } from "../App";

/**
 * «Обменять» на смене через три недели показывало пустой список.
 *
 * Свои смены грузятся от понедельника и без верхней границы, а чужие — ровно на
 * текущую неделю, и экран обмена фильтровал именно недельную выборку. Обмен же
 * возможен только внутри одного дня, значит нужен ровно один день — тот, что у
 * отдаваемой смены.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Заведомо вне текущей недели, в какой бы день тест ни запускали. */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const FAR_AWAY = daysFromNow(21);
const MY_SHIFT = {
  id: 4242,
  date: FAR_AWAY,
  endDate: null,
  start: "15:00",
  end: "23:00",
  category: "shift",
  title: "Вечер",
  templateId: 4,
  employeeId: 1,
  location: null,
  note: null,
  unrecognisedCode: null,
} as unknown as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const asked: { from: string; to: string }[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.spyOn(apiClient, "getMyShifts").mockResolvedValue({ shifts: [MY_SHIFT], today: daysFromNow(0) });
  vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(async (from: string, to: string) => {
    asked.push({ from, to });
    return { employees: [], shifts: [] };
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

describe("загрузка дня под отдаваемую смену", () => {
  it("спрашивает расписание за дату смены, а не за текущую неделю", async () => {
    const el = await mount();
    const swap = [...el.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Обменять",
    ) as HTMLElement | undefined;
    expect(swap).toBeDefined();

    await act(async () => swap!.click());
    await settle();

    expect(asked.at(-1)).toEqual({ from: FAR_AWAY, to: FAR_AWAY });
  });
});
