import { describe, it, expect } from "vitest";
import { callbackDataOf, recordApi, stubBotInfo } from "./testbot";
import { Bot } from "grammy";
import { notifyAdmins, notifyAdminsAlways } from "./notify";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { isNoticeMuted, listMutedKinds } from "../repo/notice-prefs";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
  return { bot, sent };
}

/** A `createBot` instance whose outgoing calls are captured instead of sent —
 *  needed for the handler tests, which must go through the real callback
 *  routing rather than a bare `Bot`. */
function testCreatedBot(db: Db) {
  const bot = createBot({ db, config });
  stubBotInfo(bot, { first_name: "P", username: "p_bot" });
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: {} } as never;
  });
  return { bot, calls };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

const tapUpdate = (tgId: number, data: string) => ({
  update_id: tgId * 10,
  callback_query: {
    id: String(tgId),
    from: { id: tgId, is_bot: false, first_name: "T" },
    chat_instance: "1",
    data,
    message: {
      message_id: 7,
      date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      text: "Игорь поставил себе больничный",
    },
  },
});

describe("кнопка «не писать мне про это»", () => {
  it("едет с выключаемым уведомлением и несёт его вид", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    const { bot, sent } = testBot();

    await notifyAdmins(bot, db, "self_entries", "Игорь поставил себе больничный");

    const buttons = callbackDataOf(sent[0]!);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe("notice:mute:self_entries");
  });

  it("НЕ едет с эскалацией — её выключить нельзя, и кнопка обещала бы обратное", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    const { bot, sent } = testBot();

    await notifyAdminsAlways(bot, db, "Смена без человека — нужно решение");

    expect(sent[0]?.reply_markup).toBeUndefined();
  });

  it("нажатие выключает вид у того, кто нажал", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 301);
    const { bot } = testCreatedBot(db);

    await bot.handleUpdate(tapUpdate(301, "notice:mute:swaps") as never);

    expect(isNoticeMuted(db, anya.id, "swaps")).toBe(true);
  });

  it("говорит, где вернуть, и снимает только кнопку", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 302);
    const { bot, calls } = testCreatedBot(db);

    await bot.handleUpdate(tapUpdate(302, "notice:mute:swaps") as never);

    expect(calls.some((c) => c.method === "editMessageText")).toBe(false);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
    const replies = calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    expect(replies.join("\n")).toMatch(/мини-апп/i);
  });

  // Кнопка живёт в чате Telegram вечно, а список видов — нет: вид могут
  // переименовать или убрать, и тогда старое письмо принесёт данные, которых в
  // системе больше не существует. Отвечать на это надо внятной фразой, а не
  // молчанием и не строкой-мусором в `notification_mutes`.
  it("нажатие на кнопку с исчезнувшим видом отвечает внятно и ничего не пишет в базу", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 304);
    const { bot, calls } = testCreatedBot(db);

    await bot.handleUpdate(tapUpdate(304, "notice:mute:reports_digest") as never);

    const answer = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answer?.payload.text).toBe("Такого вида уведомлений больше нет");
    expect(listMutedKinds(db, anya.id)).toEqual([]);
  });

  it("не даёт разжалованному из админов выключить чужую настройку", async () => {
    const db = makeTestDb();
    // Не админ и не в аллоулисте конфигурации — обычный работник, дотянувшийся
    // до старой кнопки в чате.
    createEmployee(db, { displayName: "Игорь", inviteToken: "i-303" });
    linkTelegramAccount(db, "i-303", 303);
    const { bot, calls } = testCreatedBot(db);

    await bot.handleUpdate(tapUpdate(303, "notice:mute:swaps") as never);

    expect(calls.some((c) => c.method === "sendMessage")).toBe(false);
  });
});
