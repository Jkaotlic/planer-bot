import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "./bot";
import { stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { testConfig } from "../test-config";

/**
 * Сервер, который принимает запрос и не отвечает никогда, — ровно то, во что
 * превращается keep-alive соединение, тихо убитое роутером: TCP «жив», ответа нет.
 * На таком соединении grammY по умолчанию ждал 500 с, а нажатия обрабатываются
 * строго по одному, — одна зависшая кнопка глушила бота для всей команды.
 */
let server: Server;
let apiRoot: string;

beforeEach(async () => {
  server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function hangingBot(callMs: number, pollGraceMs: number) {
  return stubBotInfo(
    createBot({
      db: makeTestDb(),
      config: testConfig(),
      client: { apiRoot },
      apiTimeouts: { callMs, pollGraceMs },
    }),
  );
}

async function elapsedUntilRejected(call: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await expect(call()).rejects.toThrow();
  return Date.now() - started;
}

describe("таймауты вызовов Telegram", () => {
  it("обрывает зависший ответ на кнопку за свой срок, а не за 500 с", async () => {
    const bot = hangingBot(300, 300);
    const ms = await elapsedUntilRejected(() => bot.api.answerCallbackQuery("q1"));
    expect(ms).toBeLessThan(2000);
  });

  it("даёт getUpdates дожить свой long-poll и только потом обрывает", async () => {
    const bot = hangingBot(100, 300);
    // timeout: 1 — Telegram вправе держать запрос секунду; срок вызова (100 мс)
    // к опросу не применяется, иначе опрос рвался бы на каждом круге.
    const ms = await elapsedUntilRejected(() => bot.api.getUpdates({ timeout: 1 }));
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(3000);
  });
});
