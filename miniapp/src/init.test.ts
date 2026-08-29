import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Старт SDK не имеет права уронить запуск.
 *
 * `init()` зовётся в `main.tsx` ДО `createRoot`. Значит любое исключение оттуда
 * — не «SDK не поднялся», а «приложение не нарисовало ни одного пикселя»:
 * человек видит белый экран, одинаковый для всех причин. А причин хватает:
 * мини-апп открыт не из Telegram, launch-параметры не приехали, клиент слишком
 * старый для запрошенной возможности. Ни одна из них не стоит белого экрана —
 * без SDK приложение всё ещё способно дойти до `/api/auth`, получить честный
 * отказ и сказать его словами.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@telegram-apps/sdk-react");
});

describe("init", () => {
  it("не бросает, когда SDK отказывается стартовать", async () => {
    vi.doMock("@telegram-apps/sdk-react", () => ({
      init: () => {
        throw new Error("LaunchParamsRetrieveError");
      },
      mountThemeParamsSync: Object.assign(() => {}, { isAvailable: () => true }),
      bindThemeParamsCssVars: Object.assign(() => {}, { isAvailable: () => true }),
      mountViewport: Object.assign(() => Promise.resolve(), { isAvailable: () => true }),
      bindViewportCssVars: Object.assign(() => {}, { isAvailable: () => true }),
    }));

    const { init } = await import("./init");
    expect(() => init()).not.toThrow();
  });

  it("не бросает, когда падает уже монтирование темы", async () => {
    vi.doMock("@telegram-apps/sdk-react", () => ({
      init: () => {},
      mountThemeParamsSync: Object.assign(
        () => {
          throw new Error("unsupported version");
        },
        { isAvailable: () => true },
      ),
      bindThemeParamsCssVars: Object.assign(() => {}, { isAvailable: () => true }),
      mountViewport: Object.assign(() => Promise.resolve(), { isAvailable: () => true }),
      bindViewportCssVars: Object.assign(() => {}, { isAvailable: () => true }),
    }));

    const { init } = await import("./init");
    expect(() => init()).not.toThrow();
  });
});
