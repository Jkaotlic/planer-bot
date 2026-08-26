// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Отказ входа обязан говорить человеку, что делать.
 *
 * До 26.08 мини-апп показывал на этом месте «Auth failed with status 401» —
 * английскую строку из кода, по которой не понять ни причины, ни выхода. А
 * выход есть ровно один: переоткрыть мини-апп, чтобы Telegram подписал новый
 * пропуск. Сам просроченный пропуск клиент починить не может — `initData`
 * приезжает с запуском вебвью и больше не обновляется.
 *
 * Каждый случай проверяется на СВЕЖЕМ модуле: `tokenPromise` кеширует и
 * ОТКАЗ тоже, поэтому второй тест на том же модуле получил бы ответ первого и
 * зеленел бы независимо от починки.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// Литералом, а не через константу клиента: если клиент перестанет её
// экспортировать, `toThrow(undefined)` пройдёт на любой ошибке.
const RUSSIAN = "Вход устарел. Закрой мини-апп и открой заново кнопкой «Меню» в чате с ботом.";

function respondWith(status: number) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "invalid_init_data" }), { status }),
  );
}

describe("просроченный вход говорит, что делать", () => {
  it("401 от /api/auth превращается в русскую подсказку, а не в «Auth failed»", async () => {
    respondWith(401);
    const { realClient } = await import("./client");

    await expect(realClient.getMe()).rejects.toThrow(RUSSIAN);
  });

  it("и это та же фраза, что объявлена в клиенте", async () => {
    const { AUTH_EXPIRED_MESSAGE } = await import("./client");
    expect(AUTH_EXPIRED_MESSAGE).toBe(RUSSIAN);
  });

  it("прочие отказы входа тоже по-русски и с кодом", async () => {
    // 500 — это не «переоткрой», а «сервер лежит». Разные беды, разные слова.
    respondWith(500);
    const { realClient } = await import("./client");

    const err = await realClient.getMe().then(() => null, (e: Error) => e);
    expect(err?.message).toContain("500");
    expect(err?.message).not.toContain("Auth failed");
    expect(err?.message).toMatch(/[а-яё]/i);
  });
});
