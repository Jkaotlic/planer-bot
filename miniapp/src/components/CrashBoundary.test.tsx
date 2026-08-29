// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashBoundary } from "./CrashBoundary";

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // React печатает пойманную ошибку сам — и в консоль, и событием `error` в
  // jsdom. Оба канала здесь шум: падение тут инсценировано, а не случилось.
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", swallow);
});

function swallow(event: ErrorEvent): void {
  event.preventDefault();
}

afterEach(async () => {
  window.removeEventListener("error", swallow);
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error("шифт без даты");
}

/**
 * Упавший экран обязан оставить на месте себя текст, а не пустоту.
 *
 * React 18 при необработанной ошибке рендера размонтирует всё дерево — экран
 * становится белым, и это неотличимо от «приложение не загрузилось». Человек в
 * обоих случаях видит одно и то же: ничего. Разница только в том, что здесь
 * причина известна и её можно назвать.
 */
describe("граница падения", () => {
  it("вместо белого экрана показывает объяснение по-русски", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await act(async () => {
      root!.render(createElement(CrashBoundary, null, createElement(Boom)));
    });

    expect(host!.textContent).toMatch(/[а-яё]{4,}/i);
    expect(host!.textContent).not.toBe("");
  });

  it("сообщает о падении на сервер — иначе о нём никто не узнает", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await act(async () => {
      root!.render(createElement(CrashBoundary, null, createElement(Boom)));
    });

    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/client-error"))).toBe(true);
  });

  it("исправный экран не трогает", async () => {
    await act(async () => {
      root!.render(createElement(CrashBoundary, null, createElement("p", null, "всё хорошо")));
    });

    expect(host!.textContent).toBe("всё хорошо");
  });
});
