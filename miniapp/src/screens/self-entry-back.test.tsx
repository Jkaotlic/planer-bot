// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Системная «Назад» Telegram (жест/кнопка клиента, не стрелка экрана) должна
 * вести туда же, куда стрелка — иначе она закрывает форму вместе с уже
 * введёнными полями. Проверяется подписка `useTelegramBack`, а не вёрстка —
 * SDK подменён так же, как в `miniapp/src/lib/telegram-back.test.tsx`.
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
// Частичный мок: `useIsDark`/`EntryChip` в дереве экрана зовут настоящие
// `useSignal`/`isThemeParamsDark` из того же пакета — полная подмена модуля
// роняла бы рендер, ничего не сказав про кнопку «Назад».
vi.mock("@telegram-apps/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...sdk };
});

import { AppRoot } from "@telegram-apps/telegram-ui";
import { SelfEntryScreen } from "./SelfEntryScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  sdk.listeners.length = 0;
  vi.clearAllMocks();
});

describe("«Больничный/Мероприятие» — системная «Назад» ведёт туда же, куда стрелка", () => {
  // Без неотданных смен «Назад» уходит сразу же — тот же путь, что у стрелки
  // экрана (`handleBack` без предупреждения).
  it("нажатие системной «Назад» закрывает форму без черновиков", async () => {
    const onCancel = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(
        createElement(
          AppRoot,
          null,
          createElement(SelfEntryScreen, {
            mode: "sick",
            today: "2026-08-12",
            shifts: [],
            templates: [],
            ownShifts: false,
            onCancel,
            onCreate: vi.fn(async () => []),
            onUpdate: vi.fn(async () => {}),
            onDelete: vi.fn(async () => {}),
            onOfferHandover: vi.fn(async () => {}),
            onSkipHandover: vi.fn(async () => {}),
          }),
        ),
      );
    });

    expect(sdk.listeners).toHaveLength(1);
    sdk.listeners[0]!();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
