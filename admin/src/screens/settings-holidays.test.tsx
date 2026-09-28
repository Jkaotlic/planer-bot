// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type AdminSettings } from "../api/client";
import { SettingsScreen } from "./SettingsScreen";

/**
 * «Праздники» в «Настройках» консоли — то, что мини-апп умел, а консоль нет.
 *
 * Три рычага, и каждый обязан дойти до своей ручки: автозагрузка, «Обновить
 * сейчас» и ручная отметка дня. Отметка — единственный путь сказать «31
 * декабря не работаем» до того, как бот выставит на этот день дежурных; не
 * дойди кнопка до сервера, админ узнал бы об этом по возмущённым людям.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const YEAR = new Date().getUTCFullYear();

const SETTINGS: AdminSettings = {
  swapsLocked: false,
  swapsLockUpdatedAt: null,
  swapsLockUpdatedBy: null,
  reminderHour: "20:00",
  reminderHourUpdatedBy: null,
  holidaysAuto: true,
  holidays: [{ year: YEAR, refreshedAt: "2026-09-01T09:00:00.000Z", source: "xmlcalendar", days: 22 }],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 8) {
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
  await act(async () => root!.render(createElement(SettingsScreen)));
  await settle();
  return host;
}

function holidaysCard(el: HTMLElement): HTMLElement {
  const card = el.querySelector<HTMLElement>("[data-settings='holidays']");
  if (!card) throw new Error("нет блока «Праздники»");
  return card;
}

function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

/** Controlled-поле React слушает `input`, а не присваивание `value`. */
async function typeDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("«Настройки» консоли: праздники", () => {
  it("показывает загруженный год и следующий — как ещё не опубликованный", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const card = holidaysCard(await mount());
    expect(card.textContent).toContain(`${YEAR}: 22 дн.`);
    expect(card.textContent).toContain(`${YEAR + 1}: ещё не опубликован`);
  });

  it("выключатель автозагрузки шлёт обратное значение и перечитывает настройки", async () => {
    const getSettings = vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const setAuto = vi.spyOn(apiClient, "setHolidaysAuto").mockResolvedValue();
    const card = holidaysCard(await mount());
    const before = getSettings.mock.calls.length;

    const toggle = card.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    expect(toggle.checked).toBe(true);
    await act(async () => toggle.click());
    await settle();

    expect(setAuto).toHaveBeenCalledWith(false);
    expect(getSettings.mock.calls.length).toBeGreaterThan(before);
  });

  it("«Обновить сейчас» говорит итог по каждому году словами", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const refresh = vi.spyOn(apiClient, "refreshHolidays").mockResolvedValue([
      { year: YEAR, status: "ok", added: 22, removed: 0 },
      { year: YEAR + 1, status: "missing", added: 0, removed: 0 },
    ]);
    const card = holidaysCard(await mount());

    await act(async () => buttonWith(card, "Обновить сейчас").click());
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(card.textContent).toContain(`${YEAR}: загружено 22 · ${YEAR + 1}: ещё не опубликован`);
  });

  it("отказ обновления виден в блоке, а кнопка остаётся", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "refreshHolidays").mockRejectedValue(new Error("Обновление уже идёт."));
    const card = holidaysCard(await mount());

    await act(async () => buttonWith(card, "Обновить сейчас").click());
    await settle();

    expect(card.textContent).toContain("Обновление уже идёт.");
    expect(buttonWith(card, "Обновить сейчас").disabled).toBe(false);
  });

  it("праздник по календарю можно сделать рабочим — ручкой отметки дня", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const getDay = vi
      .spyOn(apiClient, "getDayCalendar")
      .mockResolvedValue([{ date: "2026-06-12", kind: "holiday", note: "День России", source: "auto" }]);
    const mark = vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(null);
    const card = holidaysCard(await mount());

    await typeDate(card.querySelector<HTMLInputElement>("input[type='date']")!, "2026-06-12");
    expect(getDay).toHaveBeenCalledWith("2026-06-12", "2026-06-12");
    expect(card.textContent).toContain("🎉 День России — выходной");

    await act(async () => buttonWith(card, "Сделать рабочим").click());
    await settle();
    expect(mark).toHaveBeenCalledWith("2026-06-12", "workday");
  });

  it("обычную среду можно сделать выходным", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getDayCalendar").mockResolvedValue([]);
    const mark = vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(null);
    const card = holidaysCard(await mount());

    await typeDate(card.querySelector<HTMLInputElement>("input[type='date']")!, "2026-06-10");
    expect(card.textContent).toContain("Обычный рабочий день");
    // Отметки нет — снимать нечего, и кнопка про это не предлагается.
    expect(() => buttonWith(card, "Как в календаре")).toThrow();

    await act(async () => buttonWith(card, "Сделать выходным").click());
    await settle();
    expect(mark).toHaveBeenCalledWith("2026-06-10", "holiday");
  });

  it("ручную отметку можно снять — «Как в календаре»", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getDayCalendar").mockResolvedValue([
      { date: "2026-12-31", kind: "holiday", note: null, source: "manual" },
    ]);
    const mark = vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(null);
    const card = holidaysCard(await mount());

    await typeDate(card.querySelector<HTMLInputElement>("input[type='date']")!, "2026-12-31");
    expect(card.textContent).toContain("(вручную)");

    await act(async () => buttonWith(card, "Как в календаре").click());
    await settle();
    expect(mark).toHaveBeenCalledWith("2026-12-31", null);
  });
});
