// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { StartTab } from "@planer/shared";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * «Открывать сразу» — личная настройка: приложение стартует с той вкладки, что
 * человек выбрал. Правило выбора живёт в `shared/start-tab`, здесь проверяется,
 * что приложение его действительно применяет.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrapWith(me: {
  startTab: StartTab | null; isAdmin?: boolean; isObserver?: boolean; canAnnounce?: boolean;
}) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false, ...me,
    },
    myShifts: { shifts: [], today: "2026-08-20" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function mount(me: Parameters<typeof bootstrapWith>[0], search = "") {
  window.history.replaceState(null, "", `/${search}`);
  vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith(me) as never);
  // Экран «Команда» тянет расписание сам, отдельно от `bootstrap`.
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
  await settle();
  return host;
}

/**
 * Текст самого экрана, без нижнего меню.
 *
 * Проверяем по содержимому, а не по подсветке вкладки: выбранную вкладку
 * telegram-ui метит собственным классом-хэшем, а хэш меняется с версией
 * библиотеки — тест ломался бы на ровном месте. Подписи вкладок из области
 * поиска убраны, иначе слово «Команда» находилось бы всегда.
 */
function screenText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelector(".tab-bar-fit")?.remove();
  return clone.textContent ?? "";
}

/** Подпись выбранного вида на экране «Команда» — «Сегодня» или «Неделя». */
function selectedTeamView(el: HTMLElement): string | null {
  const tab = el.querySelector('[role="tab"][aria-selected="true"]');
  return tab ? (tab.textContent ?? "").trim() : null;
}

describe("экран при открытии", () => {
  it("без настройки открывает «Смены», как было всегда", async () => {
    const el = await mount({ startTab: null });
    expect(screenText(el)).toContain("Привет");
  });

  it("открывает выбранную вкладку", async () => {
    const el = await mount({ startTab: "team" });
    expect(screenText(el)).toContain("Команда");
    expect(screenText(el)).not.toContain("Привет");
  });

  /**
   * «Команда — неделя» — тот же экран, что «Команда», но открытый сразу
   * недельной сеткой. Проверяем по `aria-selected` переключателя вида: он
   * говорит, какой вид ВЫБРАН, а не какие слова оказались на экране.
   */
  it("«Команда — неделя» открывает командный экран сразу неделей", async () => {
    const el = await mount({ startTab: "team_week" });
    expect(screenText(el)).toContain("Команда");
    expect(selectedTeamView(el)).toBe("Неделя");
  });

  it("обычная «Команда» открывается днём, как открывалась", async () => {
    const el = await mount({ startTab: "team" });
    expect(selectedTeamView(el)).toBe("Сегодня");
  });

  it("работнику не открывает «Админ», даже если он записан", async () => {
    // Права могли снять после того, как выбор сохранился.
    const el = await mount({ startTab: "admin" });
    expect(screenText(el)).toContain("Привет");
  });

  it("ссылка «Анонс» из бота побеждает настройку", async () => {
    // Кнопка в боте обещает конкретный экран: настройка, перебивающая её,
    // сделала бы кнопку враньём.
    const el = await mount({ startTab: "team", isObserver: true, canAnnounce: true }, "?screen=announce");
    expect(screenText(el)).not.toContain("Команда");
  });

  it("уйти с выбранной вкладки можно, и её не возвращает обратно", async () => {
    // Настройка применяется один раз за открытие; перечитывание данных на
    // переключении вкладок не должно тащить человека назад.
    const el = await mount({ startTab: "team" });
    const swaps = [...el.querySelectorAll(".tab-bar-fit button")]
      .find((n) => (n.textContent ?? "").trim() === "Обмены") as HTMLElement;
    await act(async () => swaps.click());
    await settle(6);
    expect(screenText(el)).toContain("Пока нет заявок на обмен");
  });
});
