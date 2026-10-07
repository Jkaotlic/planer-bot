// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@telegram-apps/sdk-react", () => sdk);

import { useTelegramBack } from "./telegram-back";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

function Screen({ onBack, enabled }: { onBack: () => void; enabled?: boolean }) {
  useTelegramBack(onBack, enabled);
  return null;
}

// Нажатие системной «Назад»: Telegram зовёт ВСЕХ подписанных, как и настоящий SDK.
const press = () => [...sdk.listeners].forEach((listener) => listener());

describe("useTelegramBack", () => {
  it("показывает системную «Назад», её нажатие зовёт обработчик экрана, уход экрана прячет её", async () => {
    const onBack = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement(Screen, { onBack })));

    expect(sdk.showBackButton).toHaveBeenCalled();
    sdk.listeners[0]!();
    expect(onBack).toHaveBeenCalledTimes(1);

    await act(async () => root!.unmount());
    root = null;
    expect(sdk.hideBackButton).toHaveBeenCalled();
    expect(sdk.listeners).toHaveLength(0);
  });

  it("вложенная панель перехватывает «Назад»: срабатывает последний зарегистрированный, а не все", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement("div", null, createElement(Screen, { onBack: outer }), createElement(Screen, { onBack: inner }))));

    press();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    // Панель закрыли — «Назад» снова ведёт на экран под ней.
    await act(async () => root!.render(createElement("div", null, createElement(Screen, { onBack: outer }))));
    press();
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("кнопка прячется, только когда ушли все экраны со стеком", async () => {
    sdk.hideBackButton.mockClear();
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement("div", null, createElement(Screen, { onBack: vi.fn() }), createElement(Screen, { onBack: vi.fn() }))));
    await act(async () => root!.render(createElement("div", null, createElement(Screen, { onBack: vi.fn() }))));
    expect(sdk.hideBackButton).not.toHaveBeenCalled();
    await act(async () => root!.render(createElement("div", null)));
    expect(sdk.hideBackButton).toHaveBeenCalled();
    expect(sdk.listeners).toHaveLength(0);
  });

  it("с enabled=false обработчик не регистрируется", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(createElement("div", null, createElement(Screen, { onBack: outer }), createElement(Screen, { onBack: inner, enabled: false }))));
    press();
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });
});
