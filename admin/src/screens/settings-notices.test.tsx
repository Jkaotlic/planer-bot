// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type AdminSettings, type NoticePrefs } from "../api/client";
import { SettingsScreen } from "./SettingsScreen";

/**
 * «Что мне писать» в «Настройках» консоли — выключатели видов писем админу.
 *
 * Раньше их можно было переключить только из мини-аппа: админ, живущий в
 * консоли, получал письма, которых не хотел, и не видел, где их выключить.
 * Два требования взяты оттуда же: тумблер отзывается сразу (отстающий от
 * клика читается как сломанный) и откатывается сам, если сервер отказал.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: AdminSettings = {
  swapsLocked: false,
  swapsLockUpdatedAt: null,
  swapsLockUpdatedBy: null,
  reminderHour: "20:00",
  reminderHourUpdatedBy: null,
  holidaysAuto: true,
  holidays: [],
};

const PREFS: NoticePrefs = {
  kinds: [
    { kind: "swaps", title: "Обмены сменами", hint: "Кто с кем поменялся", enabled: true },
    { kind: "birthdays", title: "Дни рождения", hint: "За неделю до ДР", enabled: false },
  ],
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

function noticesCard(el: HTMLElement): HTMLElement {
  const card = el.querySelector<HTMLElement>("[data-settings='notices']");
  if (!card) throw new Error("нет блока «Что мне писать»");
  return card;
}

function toggleOf(card: HTMLElement, title: string): HTMLInputElement {
  const label = [...card.querySelectorAll("label")].find((l) => (l.textContent ?? "").includes(title));
  if (!label) throw new Error(`нет тумблера «${title}»`);
  return label.querySelector("input[type='checkbox']")!;
}

describe("«Настройки» консоли: что мне писать", () => {
  it("показывает виды писем с подсказкой и текущим состоянием", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getNoticePrefs").mockResolvedValue(PREFS);
    const card = noticesCard(await mount());

    expect(card.textContent).toContain("Кто с кем поменялся");
    expect(toggleOf(card, "Обмены сменами").checked).toBe(true);
    expect(toggleOf(card, "Дни рождения").checked).toBe(false);
    expect(card.textContent).toContain("его выключить нельзя");
  });

  it("клик шлёт вид и новое значение", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getNoticePrefs").mockResolvedValue(PREFS);
    const save = vi.spyOn(apiClient, "setNoticePref").mockResolvedValue({ kind: "birthdays", enabled: true });
    const card = noticesCard(await mount());

    await act(async () => toggleOf(card, "Дни рождения").click());
    await settle();

    expect(save).toHaveBeenCalledWith("birthdays", true);
    expect(toggleOf(card, "Дни рождения").checked).toBe(true);
  });

  it("отказ сервера откатывает тумблер и пишет причину у этого вида", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getNoticePrefs").mockResolvedValue(PREFS);
    vi.spyOn(apiClient, "setNoticePref").mockRejectedValue(new Error("сеть недоступна"));
    const card = noticesCard(await mount());

    await act(async () => toggleOf(card, "Обмены сменами").click());
    await settle();

    expect(toggleOf(card, "Обмены сменами").checked).toBe(true);
    expect(card.textContent).toContain("сеть недоступна");
  });

  it("не загрузился список — пишет об этом в блоке, остальные настройки на месте", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "getNoticePrefs").mockRejectedValue(new Error("Нет связи с сервером"));
    const el = await mount();

    expect(noticesCard(el).textContent).toContain("Нет связи с сервером");
    expect(el.textContent).toContain("Обмены смен —");
  });
});
