import { Bot } from "grammy";
import { describe, expect, it } from "vitest";
import { keepPolling } from "./polling";
import { stubBotInfo } from "./testbot";

type PollReply = 409 | "ok";

function harness(replies: PollReply[], opts: { maxAttempts?: number; startupError?: Error } = {}) {
  const bot = stubBotInfo(new Bot("test-token"));
  const log: string[] = [];
  const exits: number[] = [];
  const sleeps: number[] = [];
  const timeouts: Array<number | undefined> = [];
  let started = 0;
  let startupError = opts.startupError;
  // Настоящий grammY вызывает onStart после deleteWebhook, до первого getUpdates.
  // Подменяем только ответы Telegram, чтобы сохранить этот порядок.
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "deleteWebhook") {
      const error = startupError;
      startupError = undefined;
      if (error) throw error;
      return { ok: true, result: true } as never;
    }
    if (method !== "getUpdates") throw new Error(`unexpected method: ${method}`);
    timeouts.push((payload as { timeout?: number }).timeout);
    const reply = replies[timeouts.length - 1];
    if (reply === "ok") return { ok: true, result: [] } as never;
    if (reply === 409) return { ok: false, error_code: 409, description: "Conflict" };
    // Заканчивает сценарий, даже если реализация пропустила лимит.
    return { ok: false, error_code: 401, description: "Unauthorized" };
  });

  const run = keepPolling({
    bot,
    maxAttempts: opts.maxAttempts ?? 3,
    onStart: () => { started += 1; },
    log: (line) => log.push(line),
    sleep: async (ms) => { sleeps.push(ms); },
    exit: (code) => exits.push(code),
  });
  return { log, exits, sleeps, timeouts, get started() { return started; }, run };
}

describe("keepPolling", () => {
  it("после 409 повторяет короткий getUpdates и запускает публикацию меню один раз", async () => {
    const h = harness([409, "ok"]);
    await h.run;
    expect(h.sleeps).toEqual([5_000]);
    expect(h.exits).toEqual([]);
    expect(h.timeouts).toEqual([10, 10, 10]);
    expect(h.started).toBe(1);
  });

  it("исчерпывает лимит, когда каждый getUpdates заканчивается конфликтом", async () => {
    const h = harness([409, 409, 409, "ok"]);
    await h.run;
    expect(h.timeouts).toHaveLength(3);
    expect(h.sleeps).toEqual([5_000, 10_000]);
    expect(h.exits).toEqual([1]);
  });

  it("успешный ответ getUpdates сбрасывает счётчик конфликтов", async () => {
    const h = harness([409, "ok", 409, "ok"], { maxAttempts: 2 });
    await h.run;
    expect(h.timeouts).toHaveLength(5);
    expect(h.sleeps).toEqual([5_000, 5_000]);
    expect(h.exits).toEqual([]);
  });

  it("на неверный токен не крутится и процесс не роняет", async () => {
    const h = harness([]);
    await h.run;
    expect(h.timeouts).toHaveLength(1);
    expect(h.exits).toEqual([]);
    expect(h.log.join("\n")).toContain("BOT_TOKEN");
  });

  it("повторяет запуск после отказа до начала опроса", async () => {
    const h = harness(["ok"], { startupError: new Error("Network request for 'deleteWebhook' failed!") });
    await h.run;
    expect(h.sleeps).toEqual([5_000]);
    expect(h.exits).toEqual([]);
  });
});
