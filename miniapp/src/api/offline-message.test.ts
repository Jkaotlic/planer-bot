// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE, realClient } from "./client";

/**
 * Зеркало теста консоли (`admin/src/api/offline-message.test.ts`).
 *
 * `fetch` при недоступном сервере бросает `TypeError: Failed to fetch`, клиент
 * кладёт это в `Error.message`, а экраны показывают его как есть. Для человека в
 * телеграме это тем более будничная ветка: метро, лифт, рестарт сервера.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

// Литералом, а не через `OFFLINE_MESSAGE`: если клиент перестанет её
// экспортировать, импорт даст `undefined`, а `toThrow(undefined)` проходит на
// любой ошибке — тест бы «зеленел» ровно тогда, когда починки нет.
const RUSSIAN = "Нет связи с сервером — проверь интернет и попробуй ещё раз.";

describe("сетевой сбой говорит по-русски", () => {
  it("недоступный сервер отвечает фразой, а не «Failed to fetch»", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(realClient.getMe()).rejects.toThrow(RUSSIAN);
  });

  it("и это та же фраза, что объявлена в клиенте", () => {
    expect(OFFLINE_MESSAGE).toBe(RUSSIAN);
  });
});
