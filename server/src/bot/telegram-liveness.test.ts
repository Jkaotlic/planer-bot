import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBot } from "./bot";
import { stubBotInfo } from "./testbot";
import { createTelegramLiveness, TELEGRAM_STALE_MS } from "./telegram-liveness";
import { makeTestDb } from "../db/testdb";
import { testConfig } from "../test-config";

const MIN = 60_000;

/** Часы, которые двигает тест, и лог, который он читает. */
function harness(startMs = Date.UTC(2026, 9, 7, 17, 0)) {
  let now = startMs;
  const lines: string[] = [];
  const liveness = createTelegramLiveness({
    now: () => now,
    log: (line) => lines.push(line),
    teamTz: "Europe/Moscow",
  });
  return { liveness, lines, advance: (ms: number) => { now += ms; } };
}

describe("связь с Telegram", () => {
  it("свежий процесс считается на связи — опрос ещё не успел вернуться", () => {
    const { liveness } = harness();
    expect(liveness.status()).toEqual({ reachable: true });
  });

  it("единичные отказы связь не рвут, пока тишина короче порога", () => {
    const { liveness, lines, advance } = harness();
    advance(TELEGRAM_STALE_MS - MIN);
    liveness.recordFailure();
    expect(liveness.status()).toEqual({ reachable: true });
    expect(lines).toEqual([]);
  });

  it("без ответа дольше порога — нет связи, с момента первого отказа", () => {
    const { liveness, advance } = harness();
    liveness.recordOk();
    advance(MIN);
    liveness.recordFailure(); // 20:01 МСК — первый отказ
    advance(TELEGRAM_STALE_MS);
    liveness.recordFailure();
    expect(liveness.status()).toEqual({ reachable: false, since: new Date(Date.UTC(2026, 9, 7, 17, 1)) });
  });

  it("тишина без отказов тоже потеря: висящий вызов отказом ещё не стал", () => {
    const { liveness, advance } = harness();
    liveness.recordOk();
    advance(TELEGRAM_STALE_MS + 1);
    expect(liveness.status()).toEqual({ reachable: false, since: new Date(Date.UTC(2026, 9, 7, 17, 0)) });
  });

  it("ответ возвращает связь сразу", () => {
    const { liveness, advance } = harness();
    liveness.recordFailure();
    advance(TELEGRAM_STALE_MS + MIN);
    liveness.recordOk();
    expect(liveness.status()).toEqual({ reachable: true });
  });

  it("в лог — по строке на переход, а не на каждый отказ", () => {
    const { liveness, lines, advance } = harness();
    liveness.recordOk();
    advance(2 * MIN);
    liveness.recordFailure(); // 20:02 МСК
    for (let i = 0; i < 10; i++) {
      advance(MIN);
      liveness.recordFailure();
    }
    liveness.recordOk(); // 20:12 МСК
    liveness.recordOk();
    expect(lines).toEqual([
      "telegram: нет связи с 20:02",
      "telegram: связь вернулась, не было 10 мин",
    ]);
  });

  it("о потере говорит и status(), если отказов не было: вызов висит", () => {
    const { liveness, lines, advance } = harness();
    liveness.recordOk();
    advance(TELEGRAM_STALE_MS + 1);
    liveness.status();
    liveness.status();
    expect(lines).toEqual(["telegram: нет связи с 20:00"]);
  });
});

describe("перехватчик бота кормит трекер", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  /** Заглушка API: отвечает как Telegram на отказ — 400 с телом. */
  async function apiAnsweringError(): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function botWith(apiRoot: string, events: string[]) {
    const liveness = {
      recordOk: () => events.push("ok"),
      recordFailure: () => events.push("fail"),
      status: () => ({ reachable: true as const }),
    };
    return stubBotInfo(createBot({
      db: makeTestDb(),
      config: testConfig(),
      client: { apiRoot },
      apiTimeouts: { callMs: 200, pollGraceMs: 200, uploadMs: 200 },
      liveness,
    }));
  }

  it("отказ Telegram с телом — это ответ, связь есть", async () => {
    const events: string[] = [];
    const bot = botWith(await apiAnsweringError(), events);
    await expect(bot.api.sendMessage(1, "x")).rejects.toThrow(/chat not found/);
    expect(events).toEqual(["ok"]);
  });

  it("обрыв по сроку — отказ связи", async () => {
    server = createServer(() => {}); // принял и молчит, как убитый роутером keep-alive
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const events: string[] = [];
    const bot = botWith(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, events);
    await expect(bot.api.sendMessage(1, "x")).rejects.toThrow();
    expect(events).toEqual(["fail"]);
  });
});
