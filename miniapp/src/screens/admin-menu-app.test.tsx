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
import { waitFor } from "../test-wait";

/**
 * Вкладка «Админ»: меню разделов вместо ленты чипов. Проверяется сквозь `App`,
 * потому что вся логика — в связке состояния `App`, `AdminScreen` и нижней панели.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Срок ожидания условия (10 с) длиннее таймаута теста по умолчанию (5 с): без этого vitest
// убивал бы тест раньше, чем `until` сказал бы, чего именно не дождался.
vi.setConfig({ testTimeout: 30_000 });

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

/** Витки очереди микрозадач — вместо «подождать 15 мс»: ответы мок-ручек готовы, им нужен лишь виток. */
async function flush(times = 2) {
  for (let i = 0; i < times; i += 1) await act(async () => {});
}

/**
 * Ждёт условия, а не фиксированное время. Экран раздела подгружается через
 * `lazy()`, и сколько займёт этот импорт, зависит от нагрузки на машину: на
 * занятом процессоре сотня миллисекунд «пустых» ожиданий кончалась раньше, чем
 * раздел успевал нарисоваться, и тест падал раз в несколько прогонов.
 * Сообщение «не дождался: …» — чтобы по упавшему тесту было видно, чего именно нет.
 */
async function until(cond: () => boolean, what: string) {
  await waitFor(() => {
    if (!cond()) throw new Error(`не дождался: ${what}`);
  });
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
  // Метка «Админ» и строка «На подтверждение» зависят от этого ответа — без заглушки
  // тест читал бы сидовый мок, и строка меню без метки не отличалась бы от строки с ней.
  if (!vi.isMockFunction(apiClient.getSickApprovals)) vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await until(() => host!.querySelector(".tab-bar-fit button") !== null, "нижняя панель после загрузки");
  await flush();
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
}

const h1 = (el: HTMLElement) => el.querySelector("h1")?.textContent ?? null;
const untilH1 = (el: HTMLElement, title: string) => until(() => h1(el) === title, `заголовок «${title}», сейчас ${JSON.stringify(h1(el))}`);
const backButton = (el: HTMLElement) => el.querySelector('button[aria-label="Разделы"]');
const menuRows = (el: HTMLElement) => [...el.querySelectorAll("button.ui-menu-row")];
const rowTitle = (row: Element) => row.querySelector(".ui-menu-row__title")?.textContent ?? "";
function menuRow(el: HTMLElement, title: string): HTMLElement {
  const row = menuRows(el).find((r) => rowTitle(r) === title);
  if (!row) throw new Error(`нет строки меню «${title}»`);
  return row as HTMLElement;
}

describe("админка: меню разделов", () => {
  it("1. вкладка «Админ» открывается на «Расписании», с «Разделы» и без чипов", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    expect(backButton(el)).not.toBeNull();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("2. «‹ Разделы» ведёт в меню из десяти строк по порядку", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await click(backButton(el)!);
    await untilH1(el, "Админ");
    await until(() => menuRows(el).length === 10, "десять строк меню");
    const rows = menuRows(el);
    // Раздел «На подтверждение» — первым в «График»: он про решение, которого ждут люди.
    expect(rows[0]!.textContent).toContain("На подтверждение");
    // Название строки — ровно из `.ui-menu-row__title`: `toContain` по тексту всей
    // строки пропустил бы подмену названия, пока оно лежит где-то в пояснении.
    expect(rows.map(rowTitle)).toEqual(["На подтверждение", "Расписание", "Выходные", "Работники", "Группы", "Анонсы", "Чек-листы", "Журнал", "Баги", "Настройки"]);
    expect(backButton(el)).toBeNull();
  });

  it("3. строка «Работники» открывает раздел", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await click(backButton(el)!);
    await untilH1(el, "Админ");
    await click(menuRow(el, "Работники"));
    await untilH1(el, "Работники");
  });

  it("4. раздел переживает уход на другую вкладку", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await click(backButton(el)!);
    await untilH1(el, "Админ");
    await click(menuRow(el, "Работники"));
    await untilH1(el, "Работники");
    await click(tabItem(el, "Команда"));
    // Без этого ожидания тест не доказывал бы, что вкладка вообще сменилась.
    await untilH1(el, "Команда");
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Работники");
  });

  it("5. повторное нажатие «Админ» на активной вкладке — меню", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Админ");
  });

  it("6. ссылка ?screen=announce открывает «Анонсы» сразу, минуя меню", async () => {
    const el = await mount({ isAdmin: true }, "?screen=announce");
    await untilH1(el, "Анонсы");
    expect(menuRows(el)).toHaveLength(0);
  });

  it("7. системная «Назад» в разделе ведёт в меню, а в меню прячется", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await until(() => sdk.listeners.length > 0, "обработчик системной «Назад»");
    expect(sdk.showBackButton).toHaveBeenCalled();
    const hideBefore = sdk.hideBackButton.mock.calls.length;
    await act(async () => sdk.listeners[sdk.listeners.length - 1]!());
    await untilH1(el, "Админ");
    await until(() => sdk.hideBackButton.mock.calls.length > hideBefore, "скрытие системной «Назад»");
  });

  it("7б. в разделе уход на другую вкладку прячет системную «Назад»", async () => {
    const el = await mount({ isAdmin: true });
    await click(tabItem(el, "Админ"));
    await untilH1(el, "Расписание");
    await until(() => sdk.showBackButton.mock.calls.length > 0, "показ системной «Назад» в разделе");
    const hideBefore = sdk.hideBackButton.mock.calls.length;
    await click(tabItem(el, "Команда"));
    // Кнопка нужна только экрану, у которого есть куда вернуться: на «Команде»
    // она остаётся висеть в шапке Telegram и ведёт в никуда.
    await until(() => sdk.hideBackButton.mock.calls.length > hideBefore, "скрытие системной «Назад» после ухода с вкладки");
  });

  it("8. не-админ с canAnnounce: вкладка «Анонс» — заголовок без «Разделы»", async () => {
    const el = await mount({ isObserver: true, canAnnounce: true });
    await click(tabItem(el, "Анонс"));
    // Именно заголовок `Screen` — и единственный `h1`: у самого раздела не должно
    // быть своего заголовка «Анонс», иначе на экране два `h1`.
    await until(() => el.querySelector("h1.ui-screen__title")?.textContent === "Анонс", "заголовок «Анонс»");
    expect(el.querySelectorAll("h1")).toHaveLength(1);
    expect(backButton(el)).toBeNull();
  });
});
