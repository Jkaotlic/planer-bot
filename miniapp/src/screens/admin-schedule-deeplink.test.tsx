// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * «📅 Открыть график» у админской тревоги — ссылка `?screen=schedule&date=…`.
 * Разбор строки проверен отдельно (`admin-deeplink.test.ts`); здесь — что
 * приложение её действительно применяет: попадает на вкладку «Админ» и открывает
 * там нужную неделю, а не просто «Расписание» на текущей.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom не реализует scrollIntoView — `SectionChips` зовёт его, чтобы активная
// вкладка была видна на узком экране; здесь достаточно, что он не бросает.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

function bootstrapWith(me: { isAdmin?: boolean; isObserver?: boolean; canAnnounce?: boolean }) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false, startTab: null, ...me,
    },
    myShifts: { shifts: [], today: "2026-10-08" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount(me: Parameters<typeof bootstrapWith>[0], search: string) {
  window.history.replaceState(null, "", `/${search}`);
  vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith(me) as never);
  // Экран «Расписание» тянет неделю сам, отдельно от bootstrap.
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

function text(el: HTMLElement): string {
  return el.textContent ?? "";
}

describe("?screen=schedule&date=… открывает график админа на нужной неделе", () => {
  it("админ попадает на вкладку «Админ», на неделю с этой датой", async () => {
    const el = await mount({ isAdmin: true }, "?screen=schedule&date=2026-10-07");
    expect(text(el)).toContain("5–11 октября");
  });

  it("не-админа ссылка на график не пускает в админку — обычная стартовая вкладка", async () => {
    const el = await mount({ isAdmin: false }, "?screen=schedule&date=2026-10-07");
    // Как и без строки запроса вовсе: «Моих смен» с приветствием, а не график.
    expect(text(el)).toContain("Привет");
    expect(text(el)).not.toContain("5–11 октября");
  });
});
