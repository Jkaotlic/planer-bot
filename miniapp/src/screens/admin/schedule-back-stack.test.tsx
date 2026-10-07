// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";

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
// Частичный мок: `useIsDark` в дереве экрана зовёт настоящие `useSignal`/`isThemeParamsDark`.
vi.mock("@telegram-apps/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...sdk };
});

import { apiClient } from "../../api/client";
import { AdminScreen } from "../AdminScreen";

/**
 * «Назад» во вложенной панели расписания (B19): системная кнопка закрывает ПАНЕЛЬ,
 * а не весь раздел, а «‹ Разделы» при открытой форме переспрашивает, а не стирает её.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
  }
}

const press = () => act(async () => { [...sdk.listeners].forEach((l) => l()); });

async function mount(onViewChange: (view: string) => void) {
  vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScreen, { view: "schedule", onViewChange, today: "2026-09-23" })));
  });
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label || (b.textContent ?? "").includes(label));
  if (!found) throw new Error(`нет кнопки «${label}»`);
  return found as HTMLElement;
}

describe("«Назад» из вложенной панели расписания", () => {
  it("системная «Назад» закрывает панель, а следующая — раздел", async () => {
    const onViewChange = vi.fn();
    const el = await mount(onViewChange);
    await act(async () => button(el, "Виды смен").click());
    await settle();
    expect(el.textContent ?? "").toContain("Назад к расписанию");

    await press();
    await settle();
    expect(el.textContent ?? "").not.toContain("Назад к расписанию");
    expect(onViewChange).not.toHaveBeenCalled();

    await press();
    expect(onViewChange).toHaveBeenCalledWith("menu");
  });

  it("«‹ Разделы» при открытой форме не стирает её с первого нажатия", async () => {
    const onViewChange = vi.fn();
    const el = await mount(onViewChange);
    await act(async () => button(el, "Заполнить неделю").click());
    await settle();

    await act(async () => button(el, "Разделы").click());
    expect(onViewChange).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("Открыта форма");

    await act(async () => button(el, "Разделы").click());
    expect(onViewChange).toHaveBeenCalledWith("menu");
  });

  it("без открытой панели «‹ Разделы» уходит сразу", async () => {
    const onViewChange = vi.fn();
    const el = await mount(onViewChange);
    await act(async () => button(el, "Разделы").click());
    expect(onViewChange).toHaveBeenCalledWith("menu");
  });
});
