// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type AdminSettings } from "../api/client";
import { SettingsScreen } from "./SettingsScreen";

/**
 * Час рассылки напоминаний — вторая ручка на «Настройках».
 *
 * Она тише замка обменов (никому ничего не уходит сразу), но ошибиться ей можно
 * дороже: час, который не наступит до полуночи, гасит рассылку целиком и молча.
 * Поэтому отказ обязан быть виден рядом с полем, а не вместо экрана.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: AdminSettings = {
  swapsLocked: false,
  swapsLockUpdatedAt: "2026-08-07T11:30:00.000Z",
  swapsLockUpdatedBy: "Игорь Петров",
  reminderHour: "20:00",
  reminderHourUpdatedBy: "Марк Ильин",
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

function hourField(el: HTMLElement): HTMLInputElement {
  const input = el.querySelector("input.settings-reminder-hour");
  if (!input) throw new Error("поля часа напоминаний нет на экране");
  return input as HTMLInputElement;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

function saveButton(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Сохранить час"));
  if (!found) throw new Error("нет кнопки «Сохранить час»");
  return found as HTMLButtonElement;
}

describe("час напоминаний в консоли", () => {
  it("показывает текущий час и кто его менял", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const el = await mount();

    expect(hourField(el).value).toBe("20:00");
    expect(el.textContent ?? "").toContain("Марк Ильин");
  });

  it("сохраняет новый час", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const save = vi.spyOn(apiClient, "setReminderHour").mockResolvedValue(undefined);
    const el = await mount();

    await type(hourField(el), "18:30");
    await act(async () => saveButton(el).click());
    await settle();

    expect(save).toHaveBeenCalledWith("18:30");
  });

  it("час, который может не наступить, на сервер не уходит", async () => {
    const save = vi.spyOn(apiClient, "setReminderHour").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    const el = await mount();

    await type(hourField(el), "23:45");
    await act(async () => saveButton(el).click());
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("23:30");
  });

  it("отказ сервера показывается рядом с полем, а не вместо экрана", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(SETTINGS);
    vi.spyOn(apiClient, "setReminderHour").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await type(hourField(el), "19:00");
    await act(async () => saveButton(el).click());
    await settle();

    expect(el.textContent ?? "").toContain("сеть недоступна");
    // Поле обязано остаться: иначе из этого состояния нет выхода без F5.
    expect(hourField(el)).toBeTruthy();
  });
});
