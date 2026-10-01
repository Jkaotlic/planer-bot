// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Системная «Назад» Telegram для оверлея на `Screen` (например «Настройки»):
 * без подписки жест «назад» закрывал бы всё приложение, а не экран. SDK
 * подменён так же, как в `screens/self-entry-back.test.tsx`.
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
import { Screen } from "./Screen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  sdk.listeners.length = 0;
  vi.clearAllMocks();
});

describe("Screen с onBack: системная кнопка «Назад»", () => {
  it("открытие показывает её, нажатие зовёт onBack, закрытие прячет", async () => {
    const onBack = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(Screen, { title: "Настройки", onBack, children: null })));
    });

    expect(sdk.showBackButton).toHaveBeenCalledTimes(1);
    expect(sdk.listeners).toHaveLength(1);
    sdk.listeners[0]!();
    expect(onBack).toHaveBeenCalledTimes(1);

    await act(async () => root!.unmount());
    root = null;
    expect(sdk.hideBackButton).toHaveBeenCalledTimes(1);
  });

  it("с tabBar (раздел админки) системная «Назад» тоже есть и уходит при закрытии", async () => {
    const onBack = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(Screen, { title: "Баги", onBack, backLabel: "Разделы", tabBar: true, children: null })));
    });

    expect(sdk.showBackButton).toHaveBeenCalledTimes(1);
    expect(sdk.listeners).toHaveLength(1);
    sdk.listeners[0]!();
    expect(onBack).toHaveBeenCalledTimes(1);

    await act(async () => root!.unmount());
    root = null;
    expect(sdk.hideBackButton).toHaveBeenCalledTimes(1);
  });

  it("без onBack системную кнопку не трогаем", async () => {
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(Screen, { title: "Смены", children: null })));
    });
    expect(sdk.showBackButton).not.toHaveBeenCalled();
    expect(sdk.listeners).toHaveLength(0);
  });
});
