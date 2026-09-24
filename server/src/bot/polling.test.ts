import { GrammyError } from "grammy";
import { describe, expect, it } from "vitest";
import { keepPolling } from "./polling";

function grammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'getUpdates' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    "getUpdates",
    {},
  );
}

const CONFLICT = () => grammyError(409, "Conflict: terminated by other getUpdates request");

/**
 * Поддельный бот: каждый вызов `start` берёт следующий сценарий. «ok» — опрос
 * пошёл (зовёт onStart) и потом штатно остановлен; ошибка — `start` отклонён,
 * как делает grammY на 409/401.
 */
function scriptedBot(script: Array<"ok" | "started-then-409" | Error>) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async start(opts?: { onStart?: (info: { username: string }) => void }) {
      const step = script[calls++];
      if (step === undefined) throw new Error("script exhausted");
      if (step instanceof Error) throw step;
      opts?.onStart?.({ username: "planer_bot" });
      if (step === "started-then-409") throw CONFLICT();
    },
  };
}

function harness(script: Array<"ok" | "started-then-409" | Error>, maxAttempts = 3) {
  const bot = scriptedBot(script);
  const log: string[] = [];
  const exits: number[] = [];
  const sleeps: number[] = [];
  const run = keepPolling({
    bot: bot as never,
    maxAttempts,
    onStart: () => log.push("started"),
    log: (line) => log.push(line),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    exit: (code) => exits.push(code),
  });
  return { bot, log, exits, sleeps, run };
}

describe("keepPolling", () => {
  it("поднимает опрос заново после 409, а не оставляет процесс глухим", async () => {
    const h = harness([CONFLICT(), "ok"]);
    await h.run;
    expect(h.bot.calls).toBe(2);
    expect(h.log).toContain("started");
    expect(h.exits).toEqual([]);
    expect(h.sleeps).toHaveLength(1);
  });

  it("сдаётся после серии неудач подряд и роняет процесс — launchd поднимет его целиком", async () => {
    const h = harness([CONFLICT(), CONFLICT(), CONFLICT(), "ok"], 3);
    await h.run;
    expect(h.bot.calls).toBe(3);
    expect(h.exits).toEqual([1]);
  });

  it("считает неудачи подряд: успешный запуск обнуляет счёт", async () => {
    // Опрос, проработавший до 409, — не «неудачный старт»: иначе процесс,
    // переживший за неделю три чужих getUpdates, умер бы на третьем.
    const h = harness(["started-then-409", "started-then-409", "started-then-409", "ok"], 2);
    await h.run;
    expect(h.bot.calls).toBe(4);
    expect(h.exits).toEqual([]);
  });

  it("на неверный токен не крутится и процесс не роняет", async () => {
    const h = harness([grammyError(401, "Unauthorized")]);
    await h.run;
    expect(h.bot.calls).toBe(1);
    expect(h.exits).toEqual([]);
    expect(h.log.join("\n")).toContain("BOT_TOKEN");
  });

  it("сетевой отказ на старте (getMe при загрузке машины) тоже повторяет", async () => {
    const h = harness([new Error("Network request for 'getMe' failed!"), "ok"]);
    await h.run;
    expect(h.bot.calls).toBe(2);
    expect(h.exits).toEqual([]);
  });
});
