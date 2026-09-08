// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CSS и JS обязаны быть одной темы.
 *
 * Консоль открывают ссылкой в обычном браузере: SDK там не поднимается,
 * `--tg-theme-*` не появляются, и CSS красит по `--fallback-*`, то есть по
 * `prefers-color-scheme`. А `isThemeParamsDark` без темы отвечает «тёмная»
 * ВСЕГДА — и в светлом браузере всё, что красится из JS, приезжало тёмной
 * палитрой. Замер на живой странице: контраст подписи в клетке сетки был
 * 1.22 при норме 4.5, то есть текста не было видно вовсе.
 *
 * Признак «Telegram здесь есть» — смонтированная тема, а не её цвет: внутри
 * клиента она смонтирована всегда, снаружи — никогда.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signals = { mounted: false, tgDark: false };

vi.mock("@telegram-apps/sdk-react", () => ({
  isThemeParamsMounted: () => signals.mounted,
  isThemeParamsDark: () => signals.tgDark,
  useSignal: (signal: () => boolean) => signal(),
}));

function browserPrefersDark(dark: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: dark && query.includes("dark"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function readIsDark(): Promise<boolean> {
  const { useIsDark } = await import("./theme");
  let seen = false;
  function Probe() {
    seen = useIsDark();
    return null;
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  return seen;
}

beforeEach(() => {
  vi.resetModules();
  signals.mounted = false;
  signals.tgDark = false;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("тема консоли", () => {
  it("без Telegram идёт за браузером: светлый браузер — светлая палитра", async () => {
    // Именно этот случай и был сломан: тема не смонтирована, а `isThemeParamsDark`
    // отвечает «тёмная».
    signals.mounted = false;
    signals.tgDark = true;
    browserPrefersDark(false);

    expect(await readIsDark()).toBe(false);
  });

  it("без Telegram в тёмном браузере остаётся тёмной", async () => {
    signals.mounted = false;
    signals.tgDark = false;
    browserPrefersDark(true);

    expect(await readIsDark()).toBe(true);
  });

  it("внутри Telegram слушает клиент, а не браузер", async () => {
    // Обратная ошибка не менее дорогая: у человека телефон в светлом режиме,
    // а Telegram — в тёмном; красить надо по клиенту.
    signals.mounted = true;
    signals.tgDark = true;
    browserPrefersDark(false);

    expect(await readIsDark()).toBe(true);
  });
});
