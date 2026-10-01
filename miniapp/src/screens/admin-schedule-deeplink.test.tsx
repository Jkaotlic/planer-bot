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

/** Нажать вкладку нижней панели: telegram-ui рисует `Tabbar.Item` кнопкой с подписью. */
async function goTab(el: HTMLElement, label: string) {
  const item = [...el.querySelectorAll(".tab-bar-fit button, .tab-bar-fit [role=button]")]
    .find((n) => (n.textContent ?? "").trim() === label) as HTMLElement | undefined;
  if (!item) throw new Error(`нет вкладки «${label}»`);
  await act(async () => item.click());
  await settle(10);
}

describe("админка помнит раздел, а дата из ссылки не прилипает", () => {
  it("дата из ссылки — только в первый раз: вернулся во вкладку — текущая неделя", async () => {
    const el = await mount({ isAdmin: true }, "?screen=schedule&date=2026-11-18");
    expect(text(el)).toContain("16–22 ноября");
    expect(window.location.search).not.toContain("date=");

    await goTab(el, "Смены");
    await goTab(el, "Админ");

    expect(text(el)).toContain("5–11 октября");
    expect(text(el)).not.toContain("16–22 ноября");
  });

  it("выбранный раздел переживает уход на другую вкладку", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([] as never);
    const el = await mount({ isAdmin: true }, "?screen=schedule");
    // Из «Расписания» в «Работники» — через меню: «‹ Разделы» → строка.
    const back = el.querySelector('button[aria-label="Разделы"]') as HTMLElement;
    await act(async () => back.click());
    await settle(10);
    const row = [...el.querySelectorAll("button.ui-menu-row")].find((n) => (n.textContent ?? "").includes("Работники")) as HTMLElement;
    await act(async () => row.click());
    await settle(10);
    expect(el.querySelector("h1")?.textContent).toBe("Работники");

    await goTab(el, "Смены");
    await goTab(el, "Админ");

    expect(el.querySelector("h1")?.textContent).toBe("Работники");
  });
});
