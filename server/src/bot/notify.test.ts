import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { notifyUser, notifyAdmins } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
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

/** Like testBot, but sendMessage throws for the given chat_id (or for all sends, when "all"). */
function testBotFailing(failId: number | "all") {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { chat_id: number | string; text: string };
      if (failId === "all" || p.chat_id === failId) throw new Error("telegram down");
      sent.push(p);
    }
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
  it("notifyUser sends to the given telegram id and reports success", async () => {
    const { bot, sent } = testBot();
    await expect(notifyUser(bot, 999, "привет")).resolves.toBe(true);
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

  it("notifyAdmins keeps going (and does not throw) when one recipient fails", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    const { bot, sent } = testBotFailing(111);
    await expect(notifyAdmins(bot, db, "обмен состоялся")).resolves.toBeUndefined();
    expect(sent.map((s) => s.chat_id)).toEqual([222]);
  });

  it("notifyUser swallows a send failure instead of throwing, and reports it via the return value", async () => {
    const { bot } = testBotFailing("all");
    await expect(notifyUser(bot, 999, "x")).resolves.toBe(false);
  });

  it("notifyAdmins does not message an archived (inactive) admin", async () => {
    const db = makeTestDb();
    const inactive = admin(db, "Аня", 111);
    archiveEmployee(db, inactive.id, "2026-07-01");
    admin(db, "Игорь", 222);
    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "обмен состоялся");
    expect(sent.map((s) => s.chat_id)).toEqual([222]);
  });
});
