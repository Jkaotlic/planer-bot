// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Мини-апп обязан переживать протухший токен и разовый сбой сети.
 *
 * Две беды с одинаковым концом — «у человека приложение больше не работает,
 * пока он не закроет его полностью»:
 *
 * 1. JWT живёт шесть часов, а вебвью Telegram — дольше. Общий транспорт при
 *    401 сбрасывал токен, а шесть ручных помощников (`authorizedGet` и
 *    родня) — нет: они бесконечно ходили с мёртвым токеном и показывали
 *    английское «Request to /api/me failed with status 401». Ради этого и
 *    растягивали окно `initData` до суток — чтобы переавторизация была
 *    возможна; но звать её было некому.
 *
 * 2. `tokenPromise ??= requestToken()` запоминал и ОТКАЗ тоже. Один споткнув-
 *    шийся запрос на входе (лифт, рестарт сервера) — и каждый следующий вызов
 *    получал ту же отклонённую обещалку, не пытаясь заново.
 */

(globalThis as { Telegram?: unknown }).Telegram = { WebApp: { initData: "auth_date=1&hash=x&user=%7B%22id%22%3A1%7D" } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("переавторизация", () => {
  it("протухший токен обновляется сам, а не показывается человеку", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/auth")) return jsonResponse({ token: `t${calls.length}` });
      // Первый заход с протухшим токеном, второй — с новым.
      const meCalls = calls.filter((call) => call.endsWith("/api/me")).length;
      return meCalls === 1 ? jsonResponse({ error: "unauthorized" }, 401) : jsonResponse({ id: 7, displayName: "Аня" });
    });

    const { realClient } = await import("./client");
    const me = await realClient.getMe();

    expect(me.id).toBe(7);
    expect(calls.filter((call) => call.endsWith("/api/auth"))).toHaveLength(2);
  });

  it("разовый сбой входа не запоминается навсегда", async () => {
    let authAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth")) {
        authAttempts += 1;
        if (authAttempts === 1) throw new TypeError("Failed to fetch");
        return jsonResponse({ token: "ok" });
      }
      return jsonResponse({ id: 7, displayName: "Аня" });
    });

    const { realClient } = await import("./client");
    await expect(realClient.getMe()).rejects.toThrow();

    const me = await realClient.getMe();
    expect(me.id).toBe(7);
    expect(authAttempts).toBe(2);
  });

  it("отказ, который не лечится повтором, говорит по-русски", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth")) return jsonResponse({ token: "t" });
      return jsonResponse({}, 500);
    });

    const { realClient } = await import("./client");
    const err = await realClient.getMe().then(() => null, (e: Error) => e);

    expect(err?.message).toMatch(/[а-яё]{4,}/i);
    expect(err?.message).not.toContain("Request to");
  });
});
