// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE, realClient } from "./client";

/**
 * Сетевой сбой доезжал до человека английской строкой браузера.
 *
 * `fetch` при недоступном сервере бросает `TypeError: Failed to fetch`, клиент
 * кладёт это в `Error.message`, а экраны показывают его как есть — и после
 * сегодняшних починок (панели «Повторить» в консоли, в журнале, в мобильной
 * админке) эта строка стала видна в пяти новых местах. Правило то же, что у
 * `refusalText` (`c25adcf`): то, что читает человек, написано по-русски.
 *
 * Повод дёрнуть ветку будничный: рестарт сервера при выкладке.
 */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// Литералом, а не через `OFFLINE_MESSAGE`: если клиент перестанет её
// экспортировать, импорт даст `undefined`, а `toThrow(undefined)` проходит на
// любой ошибке — тест бы «зеленел» ровно тогда, когда починки нет.
const RUSSIAN = "Нет связи с сервером — проверь интернет и попробуй ещё раз.";

describe("сетевой сбой говорит по-русски", () => {
  it("недоступный сервер отвечает фразой, а не «Failed to fetch»", async () => {
    // Токен в хранилище, иначе клиент упрётся в отсутствие initData раньше сети.
    window.localStorage.setItem("adminToken", "token-for-the-test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(realClient.getEmployees()).rejects.toThrow(RUSSIAN);
  });

  it("а ответ сервера с причиной остаётся тем, что сказал сервер", async () => {
    window.localStorage.setItem("adminToken", "token-for-the-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Уже есть работник с таким ФИО" }), { status: 409 }),
    );

    await expect(realClient.getEmployees()).rejects.toThrow("Уже есть работник с таким ФИО");
  });

  it("и это та же фраза, что объявлена в клиенте", () => {
    expect(OFFLINE_MESSAGE).toBe(RUSSIAN);
  });
});
