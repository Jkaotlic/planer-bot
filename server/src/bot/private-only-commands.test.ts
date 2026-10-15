import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { recordApi, stubBotInfo } from "./testbot";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId } from "../repo/employees";
import { createChecklist } from "../repo/checklists";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * Команды, чей ответ личный, в групповом чате не отвечают по существу.
 *
 * Ответ бота уходит туда, откуда пришла команда, — в группу его увидят все
 * участники. Для `/admin` это админский токен на 12 часов, для остальных —
 * личные настройки и кнопки, нажатие которых в группе всё равно сделало бы
 * дело от имени нажавшего, а не того, кто спросил.
 */

const config = testConfig(); // аллоулист — 111

function testBot(db: Db) {
  const bot = stubBotInfo(createBot({ db, config }));
  const { sent, calls } = recordApi(bot);
  return { bot, sent, calls };
}

function groupCommand(tgId: number, text: string, type: "group" | "supergroup" = "supergroup") {
  const command = text.split(" ")[0]!;
  return {
    update_id: 1,
    message: {
      message_id: 4,
      date: 1_712_803_046,
      chat: { id: -1_001_234_567, title: "Смены", type },
      from: { id: tgId, is_bot: false, first_name: "Аня" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: command.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

function linkedAdmin(db: Db, tgId: number) {
  createEmployee(db, { displayName: "Аня", inviteToken: `tok-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "anya", "Аня");
  return getByTelegramId(db, tgId)!;
}

describe("личные команды в групповом чате", () => {
  it.each(["supergroup", "group"] as const)("/admin в %s не выпускает токен", async (type) => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(groupCommand(111, "/admin", type));
    expect(sent.some((m) => m.text.includes("#token="))).toBe(false);
    expect(sent.map((m) => m.text)).toEqual(["Админку открывают только в личном чате с ботом."]);
  });

  it("/admin в группе не заводит аллоулистнутому админу строку и не трогает его меню команд", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCommand(111, "/admin"));
    expect(getByTelegramId(db, 111)).toBeUndefined();
    expect(calls.some((c) => c.method === "setMyCommands")).toBe(false);
  });

  it("/notifications в группе не показывает чужие настройки и тумблер", async () => {
    const db = makeTestDb();
    linkedAdmin(db, 500);
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(groupCommand(500, "/notifications"));
    expect(sent.map((m) => m.text)).toEqual(["Напоминания настраивают в личном чате с ботом."]);
    expect(sent[0]?.reply_markup).toBeUndefined();
  });

  it("/instruction в группе не открывает выбор чек-листа", async () => {
    const db = makeTestDb();
    linkedAdmin(db, 500);
    createChecklist(db, "Утро");
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(groupCommand(500, "/instruction"));
    expect(sent.map((m) => m.text)).toEqual(["Инструкцию прикладывают в личном чате с ботом."]);
    expect(sent[0]?.reply_markup).toBeUndefined();
  });

  it("/start с приглашением в группе не привязывает аккаунт и не называет строку расписания", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь Марков", inviteToken: "tok-g" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(groupCommand(600, "/start tok-g"));
    expect(getByTelegramId(db, 600)).toBeUndefined();
    expect(sent.map((m) => m.text)).toEqual(["Напиши мне в личный чат — в группе я не отвечаю."]);
  });

  it("/start в группе не заводит аллоулистнутого админа", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(groupCommand(111, "/start"));
    expect(getByTelegramId(db, 111)).toBeUndefined();
    expect(sent.map((m) => m.text)).toEqual(["Напиши мне в личный чат — в группе я не отвечаю."]);
  });
});
