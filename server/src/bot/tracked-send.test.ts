import { describe, it, expect } from "vitest";
import { GrammyError } from "grammy";
import { silentBot } from "./testbot";
import { sendTracked } from "./tracked-send";

describe("sendTracked", () => {
  it("возвращает message_id отправленного письма", async () => {
    const { bot } = silentBot();
    bot.api.config.use(() => ({ ok: true, result: { message_id: 42 } }) as never);
    expect(await sendTracked(bot, 100, "привет")).toBe(42);
  });

  it("при ошибке Telegram отдаёт null и не бросает", async () => {
    const { bot } = silentBot();
    bot.api.config.use(() => {
      throw new GrammyError("blocked", { ok: false, error_code: 403, description: "Forbidden" }, "sendMessage", {});
    });
    expect(await sendTracked(bot, 100, "привет")).toBeNull();
  });
});
