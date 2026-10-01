// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Системная «Назад» Telegram: SDK подменён так же, как в `ui/screen-back.test.tsx`
 * (вне Telegram кнопки нет, а проверить надо, что раздел админки её показывает
 * и что нажатие ведёт в меню).
 */
const sdk = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  const available = <T extends (...a: never[]) => unknown>(fn: T) => Object.assign(fn, { isAvailable: () => true });
  return {
    listeners,
    showBackButton: available(vi.fn()),
    hideBackButton: available(vi.fn()),
    mountBackButton: available(vi.fn()),
    isBackButtonMounted: vi.fn(() => false),
    onBackButtonClick: available(vi.fn((l: () => void) => { listeners.push(l); return () => listeners.splice(listeners.indexOf(l), 1); })),
    offBackButtonClick: available(vi.fn()),
  };
});
vi.mock("@telegram-apps/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...sdk };
});

import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * Вкладка «Админ»: меню разделов вместо ленты чипов. Проверяется сквозь `App`,
 * потому что вся логика — в связке состояния `App`, `AdminScreen` и нижней панели.
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
  sdk.listeners.length = 0;
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount(me: Parameters<typeof bootstrapWith>[0], search = "") {
  window.history.replaceState(null, "", `/${search}`);
  vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith(me) as never);
  // Запросы самих разделов — пустыми ответами: сквозной тест про меню, не про них.
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([] as never);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([] as never);
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([] as never);
  vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([] as never);
  vi.spyOn(apiClient, "getAnnouncementRecipients").mockResolvedValue([] as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

/** Пункт нижней панели по подписи. */
function tabItem(el: HTMLElement, label: string): HTMLElement {
  const item = [...el.querySelectorAll(".tab-bar-fit button")].find((b) => (b.textContent ?? "").includes(label));
  if (!item) throw new Error(`нет вкладки «${label}»`);
  return item as HTMLElement;
}

async function click(node: Element) {
  await act(async () => (node as HTMLElement).click());
  await settle(8);
}

const h1 = (el: HTMLElement) => el.querySelector("h1")?.textContent ?? null;
const backButton = (el: HTMLElement) => el.querySelector('button[aria-label="Разделы"]');
const menuRows = (el: HTMLElement) => [...el.querySelectorAll("button.ui-menu-row")];
function menuRow(el: HTMLElement, title: string): HTMLElement {
  const row = menuRows(el).find((r) => (r.textContent ?? "").includes(title));
  if (!row) throw new Error(`нет строки меню «${title}»`);
  return row as HTMLElement;
}

describe("админка: меню разделов", () => {
  it("1. вкладка «Админ» открывается на «Расписании», с «Разделы» и без чипов", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    expect(h1(el)).toBe("Расписание");
    expect(backButton(el)).not.toBeNull();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("2. «‹ Разделы» ведёт в меню из девяти строк по порядку", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await click(backButton(el)!);
    expect(h1(el)).toBe("Админ");
    const rows = menuRows(el);
    expect(rows).toHaveLength(9);
    const titles = ["Расписание", "Выходные", "Работники", "Группы", "Анонсы", "Чек-листы", "Журнал", "Баги", "Настройки"];
    rows.forEach((row, i) => expect(row.textContent ?? "").toContain(titles[i]!));
    expect(backButton(el)).toBeNull();
  });

  it("3. строка «Работники» открывает раздел", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await click(backButton(el)!);
    await click(menuRow(el, "Работники"));
    expect(h1(el)).toBe("Работники");
  });

  it("4. раздел переживает уход на другую вкладку", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await click(backButton(el)!);
    await click(menuRow(el, "Работники"));
    await click(tabItem(el, "Команда"));
    await click(tabItem(el, "Админ"));
    expect(h1(el)).toBe("Работники");
  });

  it("5. повторное нажатие «Админ» на активной вкладке — меню", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    expect(h1(el)).toBe("Расписание");
    await click(tabItem(el, "Админ"));
    expect(h1(el)).toBe("Админ");
  });

  it("6. ссылка ?screen=announce открывает «Анонсы» сразу, минуя меню", async () => {
    const el = await mount({ isAdmin: true }, "?screen=announce");
    expect(h1(el)).toBe("Анонсы");
    expect(menuRows(el)).toHaveLength(0);
  });

  it("7. системная «Назад» в разделе ведёт в меню, а в меню прячется", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    expect(sdk.showBackButton).toHaveBeenCalled();
    expect(sdk.listeners.length).toBeGreaterThan(0);
    const hideBefore = sdk.hideBackButton.mock.calls.length;
    await act(async () => sdk.listeners[sdk.listeners.length - 1]!());
    await settle(8);
    expect(h1(el)).toBe("Админ");
    expect(sdk.hideBackButton.mock.calls.length).toBeGreaterThan(hideBefore);
  });

  it("8. не-админ с canAnnounce: вкладка «Анонс» — заголовок без «Разделы»", async () => {
    const el = await mount({ isObserver: true, canAnnounce: true });
    await click(tabItem(el, "Анонс"));
    // Именно заголовок `Screen` — и единственный `h1`: у самого раздела не должно
    // быть своего заголовка «Анонс», иначе на экране два `h1`.
    expect(el.querySelector("h1.ui-screen__title")?.textContent).toBe("Анонс");
    expect(el.querySelectorAll("h1")).toHaveLength(1);
    expect(backButton(el)).toBeNull();
  });
});
