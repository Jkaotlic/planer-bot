import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { notifyUser, notifyAdmins } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import type { Db } from "../db/client";

function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

describe("notify", () => {
  it("notifyUser sends to the given telegram id", async () => {
    const { bot, sent } = testBot();
    await notifyUser(bot, 999, "привет");
    expect(sent).toEqual([{ chat_id: 999, text: "привет" }]);
  });

  it("notifyAdmins messages every linked active admin", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    createEmployee(db, { displayName: "Работник" }); // non-admin, unlinked — must NOT be messaged
    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "обмен состоялся");
    expect(sent.map((s) => s.chat_id).sort()).toEqual([111, 222]);
    expect(sent.every((s) => s.text === "обмен состоялся")).toBe(true);
  });
});
