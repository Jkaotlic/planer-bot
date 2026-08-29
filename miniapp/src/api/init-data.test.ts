// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Пропуск надо достать даже тогда, когда SDK его достать не может.
 *
 * Проверено контрольным опытом на самом SDK: те же параметры запуска, одна
 * разница — поле `signature`. С ним `retrieveRawInitData` отдаёт строку; без
 * него ВСЕ пути (`retrieveRawInitData`, `retrieveRawLaunchParams`,
 * `retrieveLaunchParams`, `restoreInitData`) бросают LaunchParamsRetrieveError
 * «Unable to retrieve launch parameters from any known source». А `signature`
 * Telegram начал присылать только с Bot API 7.10 — то есть у всех, чьё
 * приложение старше, пропуска нет вовсе, всегда, из любого входа.
 *
 * Строгость здесь чужая и лишняя: подпись проверяет сервер, по `hash`, и поле
 * `signature` ему не нужно. Значит клиенту достаточно сырой строки, откуда бы
 * она ни пришла.
 */

const USER = encodeURIComponent(JSON.stringify({ id: 1, first_name: "Аня" }));
const OLD_CLIENT_INIT_DATA = `auth_date=1756000000&hash=abc123&user=${USER}`;

function mockSdk(behaviour: "работает" | "бросает") {
  vi.doMock("@telegram-apps/sdk-react", () => ({
    restoreInitData: () => {
      if (behaviour === "бросает") throw new Error("LaunchParamsRetrieveError");
    },
    initDataRaw: () => (behaviour === "работает" ? "из-sdk" : undefined),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@telegram-apps/sdk-react");
  window.location.hash = "";
  sessionStorage.clear();
  delete (window as { Telegram?: unknown }).Telegram;
});

describe("чтение пропуска", () => {
  it("берёт у SDK, когда тот отвечает", async () => {
    mockSdk("работает");
    const { readInitData } = await import("./init-data");

    expect(readInitData()).toBe("из-sdk");
  });

  it("старый Telegram: SDK бросает, а глобал Telegram.WebApp пропуск отдаёт", async () => {
    mockSdk("бросает");
    (window as { Telegram?: unknown }).Telegram = { WebApp: { initData: OLD_CLIENT_INIT_DATA } };
    const { readInitData } = await import("./init-data");

    expect(readInitData()).toBe(OLD_CLIENT_INIT_DATA);
  });

  it("глобала нет — пропуск достаётся из хеша запуска", async () => {
    mockSdk("бросает");
    window.location.hash = `#tgWebAppData=${encodeURIComponent(OLD_CLIENT_INIT_DATA)}&tgWebAppVersion=6.0`;
    const { readInitData } = await import("./init-data");

    expect(readInitData()).toBe(OLD_CLIENT_INIT_DATA);
  });

  it("вебвью перезагрузили, хеша больше нет — пропуск достаётся из sessionStorage", async () => {
    mockSdk("бросает");
    sessionStorage.setItem(
      "tapps/launchParams",
      JSON.stringify(`tgWebAppData=${encodeURIComponent(OLD_CLIENT_INIT_DATA)}&tgWebAppVersion=6.0`),
    );
    const { readInitData } = await import("./init-data");

    expect(readInitData()).toBe(OLD_CLIENT_INIT_DATA);
  });

  it("взять неоткуда — пустая строка, а не исключение", async () => {
    mockSdk("бросает");
    const { readInitData } = await import("./init-data");

    expect(readInitData()).toBe("");
  });

  it("недоступное хранилище не роняет чтение", async () => {
    mockSdk("бросает");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { readInitData } = await import("./init-data");

    expect(() => readInitData()).not.toThrow();
  });
});
