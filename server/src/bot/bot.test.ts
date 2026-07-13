import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId } from "../repo/employees";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

/** A bot with botInfo set (skips getMe) and a transformer capturing outgoing sendMessage. */
function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function startUpdate(tgId: number, text: string, username?: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: tgId, is_bot: false, first_name: "T", username },
      chat: { id: tgId, first_name: "T", type: "private" as const },
      date: 1_712_803_046,
      text,
      entities: [{ offset: 0, length: 6, type: "bot_command" as const }],
    },
  };
}

describe("bot /start", () => {
  it("links a worker via /start <token> and greets by name", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-1" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(333, "/start tok-1", "igor"));
    expect(getByTelegramId(db, 333)?.id).toBe(w.id);
    expect(sent[0]?.text).toContain("Игорь");
  });

  it("replies invalid for an unknown/used token (and does not link)", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(444, "/start nope"));
    expect(getByTelegramId(db, 444)).toBeUndefined();
    expect(sent[0]?.text.toLowerCase()).toContain("ссылк");
  });

  it("tells an already-linked user they're linked, without re-linking", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня", inviteToken: "a" });
    linkTelegramAccount(db, "a", 555);
    const other = createEmployee(db, { displayName: "Марк", inviteToken: "m" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(555, "/start m")); // 555 already linked, tries Марк's token
    expect(getByTelegramId(db, 555)?.displayName).toBe("Аня"); // unchanged
    expect(getByTelegramId(db, other.telegramUserId ?? -1)).toBeUndefined();
    expect(sent[0]?.text).toContain("Аня");
  });

  it("nudges an unknown user with no token to ask an admin", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(666, "/start"));
    expect(sent[0]?.text.toLowerCase()).toContain("админ");
  });
});
