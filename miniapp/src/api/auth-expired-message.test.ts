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
  delete (window as { Telegram?: unknown }).Telegram;
});

// Литералом, а не через константу клиента: если клиент перестанет её
// экспортировать, `toThrow(undefined)` пройдёт на любой ошибке.
const RUSSIAN = "Вход устарел. Закрой мини-апп и открой заново кнопкой «Меню» в чате с ботом.";

function respondWith(status: number) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "invalid_init_data" }), { status }),
  );
}

/**
 * Пропуск у запуска ЕСТЬ — иначе проверялась бы другая ветка.
 *
 * «Вход устарел» и «эта кнопка не передаёт вход» — разные беды с разными
 * выходами, и различает их ровно наличие `initData`. Без этой подготовки все
 * тесты ниже уехали бы во вторую ветку и зеленели бы, ничего не проверяя.
 */
function launchedWithInitData(): void {
  (window as unknown as { Telegram?: unknown }).Telegram = {
    WebApp: { initData: "auth_date=1&hash=x&user=%7B%22id%22%3A1%7D" },
  };
}

describe("просроченный вход говорит, что делать", () => {
  it("401 от /api/auth превращается в русскую подсказку, а не в «Auth failed»", async () => {
    launchedWithInitData();
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
    launchedWithInitData();
    respondWith(500);
    const { realClient } = await import("./client");

    const err = await realClient.getMe().then(() => null, (e: Error) => e);
    expect(err?.message).toContain("500");
    expect(err?.message).not.toContain("Auth failed");
    expect(err?.message).toMatch(/[а-яё]/i);
  });
});

/**
 * 403 и 429 — не «переоткрой». Их выучили отдельно, потому что до этого клиент
 * отвечал на них «Не удалось войти: сервер ответил 403. Попробуй ещё раз.» —
 * совет, который не помогает НИКОГДА: непривязанному человеку переоткрытие не
 * привяжет Telegram, а упершемуся в лимит — не сбросит счётчик.
 */
describe("отказ, который переоткрытием не лечится", () => {
  it("403 объясняет, что человека не привязали, и куда идти", async () => {
    launchedWithInitData();
    respondWith(403);
    const { realClient } = await import("./client");

    const err = await realClient.getMe().then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/[а-яё]/i);
    expect(err?.message).not.toContain("403");
    expect(err?.message).not.toMatch(/попробуй ещё раз/i);
    expect(err?.message).toMatch(/админ/i);
  });

  it("429 просит подождать, а не жать снова", async () => {
    launchedWithInitData();
    respondWith(429);
    const { realClient } = await import("./client");

    const err = await realClient.getMe().then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/[а-яё]/i);
    expect(err?.message).toMatch(/минут|подожд/i);
  });
});

/**
 * Запуск без пропуска — это не «пропуск устарел».
 *
 * Telegram документированно не кладёт `initData`, если мини-апп открыт из
 * кнопки ОБЫЧНОЙ клавиатуры. У части команды в чате до сих пор висит старая
 * раскладка, где «📋 Мои смены» была именно такой кнопкой: Telegram держит
 * reply-клавиатуру, пока бот не пришлёт новую, а тап по web_app-кнопке боту
 * ничего не шлёт — повода прислать новую не возникает никогда. Человек жмёт ту
 * же кнопку, что и коллега, и у него не работает, а у коллеги работает.
 *
 * Совет «переоткрой» ему бесполезен: сколько ни переоткрывай той же кнопкой,
 * подписи не появится. Полезен другой — `/start`, который заменит клавиатуру.
 */
describe("запуск, в котором пропуска нет вовсе", () => {
  it("советует /start и кнопку «Меню», а не «переоткрой»", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_init_data" }), { status: 401 }),
    );
    const { realClient } = await import("./client");

    const err = await realClient.getMe().then(() => null, (e: Error) => e);
    expect(err?.message).toContain("/start");
    expect(err?.message).toMatch(/меню/i);
  });
});
