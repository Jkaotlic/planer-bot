// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Системная «Назад» Telegram (жест/кнопка клиента, не стрелка экрана) должна
 * вести туда же, куда стрелка — иначе она закрывает всё приложение вместе с
 * выбранным коллегой и уже набранным сообщением. Проверяется подписка
 * `useTelegramBack`, а не вёрстка — SDK подменён так же, как в
 * `miniapp/src/lib/telegram-back.test.tsx`.
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
// Частичный мок: `useIsDark` (лежит в дереве экрана через `EntryChip`) зовёт
// настоящие `useSignal`/`isThemeParamsDark` из того же пакета — полная
// подмена модуля роняла бы рендер, ничего не сказав про кнопку «Назад».
vi.mock("@telegram-apps/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...sdk };
});

import { AppRoot } from "@telegram-apps/telegram-ui";
import { ProposeSwapScreen } from "./ProposeSwapScreen";
import type { Shift } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FROM_SHIFT: Shift = {
  id: 1, date: "2099-01-05", start: "10:00", end: "19:00", endDate: null,
  category: "shift", title: "День", location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: 7,
} as Shift;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  sdk.listeners.length = 0;
  vi.clearAllMocks();
});

describe("«Предложить обмен» — системная «Назад» ведёт туда же, куда стрелка", () => {
  it("нажатие системной «Назад» закрывает экран так же, как своя стрелка", async () => {
    const onCancel = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(
        createElement(
          AppRoot,
          null,
          createElement(ProposeSwapScreen, {
            fromShift: FROM_SHIFT,
            candidates: [],
            templates: [],
            sameKindCount: 0,
            loading: false,
            loadError: null,
            onCancel,
            onConfirm: vi.fn(async () => {}),
          }),
        ),
      );
    });

    expect(sdk.listeners).toHaveLength(1);
    sdk.listeners[0]!();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
