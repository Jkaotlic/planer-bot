import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { stubBotInfo } from "./testbot";
import { createBot } from "./bot";
import { installBlockedTracker } from "./blocked-tracker";
import { notifyUser } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";
import { eq } from "drizzle-orm";
import { employees } from "../db/schema";

function linked(db: Db, name: string, tg: number) {
  createEmployee(db, { displayName: name, inviteToken: `i-${tg}` });
  return linkTelegramAccount(db, `i-${tg}`, tg)!;
}

/** Бот, которому Telegram отвечает 403 на всё — трекер ставится снаружи. */
function blockedBot(db: Db) {
  const bot = stubBotInfo(new Bot("1:t"));
  bot.api.config.use(() => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }) as never);
  installBlockedTracker(bot, db);
  return bot;
}

describe("бот помнит «заблокировал»", () => {
  it("403 на письмо — у человека отметка", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 801);
    expect(await notifyUser(blockedBot(db), 801, "привет")).toBe(false);
    expect(getEmployeeById(db, anya.id)!.botBlockedAt).not.toBeNull();
  });

  it("повторный 403 не сдвигает дату — «не слышит с 12-го» полезнее последней попытки", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 804);
    const first = new Date("2026-09-12T10:00:00Z");
    db.update(employees).set({ botBlockedAt: first }).where(eq(employees.id, anya.id)).run();
    await notifyUser(blockedBot(db), 804, "ещё раз");
    expect(getEmployeeById(db, anya.id)!.botBlockedAt?.getTime()).toBe(first.getTime());
  });

  it("403 на незнакомый чат — ничего не падает и никого не отмечает", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 802);
    expect(await notifyUser(blockedBot(db), 999, "привет")).toBe(false);
    expect(getEmployeeById(db, anya.id)!.botBlockedAt).toBeNull();
  });

  it("человек написал боту — отметка снята", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 803);
    await notifyUser(blockedBot(db), 803, "привет");
    const bot = stubBotInfo(createBot({ db, config: testConfig() }));
    bot.api.config.use(() => ({ ok: true, result: { message_id: 1 } }) as never);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1, date: 1_712_803_046,
        chat: { id: 803, first_name: "А", type: "private" },
        from: { id: 803, is_bot: false, first_name: "А" },
        text: "привет",
      },
    } as never);

    expect(getEmployeeById(db, anya.id)!.botBlockedAt).toBeNull();
  });
});
