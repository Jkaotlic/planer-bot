// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSettings as AdminSettingsData } from "../../api/client";
import { AdminSettings as AdminSettingsScreen } from "./AdminSettings";

/**
 * Секция «Праздники»: рычаг, что загружено и кнопка обновления.
 *
 * Год, которого нет в ответе, подписан «ещё не опубликован»: 404 источника —
 * не поломка, а «Правительство ещё не утвердило», и молчать об этом нельзя —
 * иначе пустая строка читается как сбой загрузки.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: AdminSettingsData = {
  swapsLocked: false,
  swapsLockUpdatedAt: null,
  swapsLockUpdatedBy: null,
  reminderHour: "20:00",
  reminderHourUpdatedBy: null,
  holidaysAuto: true,
  holidays: [{ year: 2026, refreshedAt: "2026-09-04T10:00:00.000Z", source: "xmlcalendar", days: 22 }],
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

async function mount(settings: AdminSettingsData = SETTINGS) {
  vi.spyOn(apiClient, "getSettings").mockResolvedValue(settings);
  vi.spyOn(apiClient, "getNoticePrefs").mockResolvedValue({ kinds: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminSettingsScreen)));
  });
  await settle();
  return host;
}

function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found;
}

describe("настройки — праздники", () => {
  it("показывает загруженный год и говорит про неопубликованный следующий", async () => {
    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).toContain("2026");
    expect(text).toContain("22");
    expect(text).toContain("2027");
    expect(text).toContain("ещё не опубликован");
  });

  it("отмечает зашитую копию словами, а не молча", async () => {
    const el = await mount({
      ...SETTINGS,
      holidays: [{ year: 2026, refreshedAt: "2026-09-04T10:00:00.000Z", source: "bundled", days: 22 }],
    });
    expect(el.textContent ?? "").toContain("зашитая копия");
  });

  it("тумблер выключает автозагрузку и перечитывает настройки", async () => {
    const setAuto = vi.spyOn(apiClient, "setHolidaysAuto").mockResolvedValue(undefined);
    const el = await mount();

    const toggle = el.querySelector<HTMLInputElement>('input[aria-label="Брать праздники из календаря"]');
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
    });
    await settle(4);

    expect(setAuto).toHaveBeenCalledWith(false);
  });

  it("кнопка «Обновить сейчас» показывает итог по годам", async () => {
    vi.spyOn(apiClient, "refreshHolidays").mockResolvedValue([
      { year: 2026, status: "ok", added: 22, removed: 22 },
      { year: 2027, status: "missing", added: 0, removed: 0 },
    ]);
    const el = await mount();

    await act(async () => {
      buttonWith(el, "Обновить сейчас").click();
    });
    await settle(4);

    const text = el.textContent ?? "";
    expect(text).toContain("2026: загружено 22");
    expect(text).toContain("2027: ещё не опубликован");
  });
});

describe("настройки — зоны нажатия", () => {
  it("тап по названию и описанию строки НЕ переключает автозагрузку — только сам тумблер", async () => {
    // Настройка сохраняется сразу: оборачивать строку в `label` значило бы, что
    // случайное касание текста при прокрутке меняет её без подтверждения.
    const setAuto = vi.spyOn(apiClient, "setHolidaysAuto").mockResolvedValue(undefined);
    const el = await mount();
    const input = el.querySelector('input[aria-label="Брать праздники из календаря"]') as HTMLInputElement;

    const title = [...el.querySelectorAll<HTMLElement>("*")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").trim() === "Брать праздники из календаря",
    )!;
    const description = [...el.querySelectorAll<HTMLElement>("*")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").startsWith("Производственный календарь"),
    )!;
    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
    await act(async () => title.click());
    await act(async () => description.click());
    await settle(4);
    expect(setAuto).not.toHaveBeenCalled();

    await act(async () => input.click());
    await settle(4);
    expect(setAuto).toHaveBeenCalledTimes(1);
    expect(setAuto).toHaveBeenCalledWith(false);
  });

  it("поле часа не ниже нажимаемого", async () => {
    const el = await mount();
    const time = el.querySelector('input[type="time"]') as HTMLInputElement;
    expect(time.style.minHeight).toBe("var(--app-tap)");
  });
});
