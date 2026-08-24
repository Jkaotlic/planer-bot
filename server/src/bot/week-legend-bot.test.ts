import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * Расшифровка букв под картинкой недели — личная настройка, и переключается она
 * там, где виден результат: кнопкой под самой картинкой.
 */
const config = testConfig();

function stage() {
  const db: Db = makeTestDb();
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-1" });
  linkTelegramAccount(db, "inv-1", 333);
  const preset = listActiveTemplates(db)[0]!;
  createShift(db, {
    date: teamNow(config.teamTz).date, start: "08:00", end: "17:00",
    employeeId: igor.id, category: "shift", templateId: preset.id,
  });
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, igor };
}

let updateId = 1;

async function send(bot: Bot, from: number, text: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId, date: Math.floor(Date.now() / 1000),
      chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "T" }, text,
    },
  } as never);
}

async function tap(bot: Bot, from: number, data: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId), from: { id: from, is_bot: false, first_name: "T" }, chat_instance: "1", data,
      message: {
        message_id: updateId, date: Math.floor(Date.now() / 1000),
        chat: { id: from, type: "private" }, from: { id: 1, is_bot: true, first_name: "P" }, text: "…",
      },
    },
  } as never);
}

describe("расшифровка букв под картинкой недели", () => {
  it("под графиком есть кнопка, которая её убирает", async () => {
    const { db, bot, igor } = stage();
    const api = recordApi(bot);

    await send(bot, 333, "📅 График");
    const photo = api.calls.find((c) => c.method === "sendPhoto")!;
    const buttons = ((photo.payload as { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } })
      .reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
    expect(buttons).toContain("week:legend:0");

    await tap(bot, 333, "week:legend:0");

    expect(getEmployeeById(db, igor.id)!.weekLegend).toBe(false);
  });

  it("повторное нажатие возвращает её", async () => {
    const { db, bot, igor } = stage();
    recordApi(bot);

    await tap(bot, 333, "week:legend:0");
    await tap(bot, 333, "week:legend:0");

    expect(getEmployeeById(db, igor.id)!.weekLegend).toBe(true);
  });

  it("настройка одного человека не трогает другого", async () => {
    // Личная, а не общая: у одного коды выучены, у другого нет.
    const { db, bot, igor } = stage();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-2" });
    linkTelegramAccount(db, "inv-2", 444);
    recordApi(bot);

    await tap(bot, 333, "week:legend:0");

    expect(getEmployeeById(db, igor.id)!.weekLegend).toBe(false);
    expect(getEmployeeById(db, anya.id)!.weekLegend).toBe(true);
  });

  it("подпись кнопки говорит, что случится по нажатию", async () => {
    const { bot } = stage();
    const api = recordApi(bot);

    await send(bot, 333, "📅 График");
    const photo = api.calls.find((c) => c.method === "sendPhoto")!;
    const labels = ((photo.payload as { reply_markup?: { inline_keyboard?: { text: string }[][] } })
      .reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(labels.some((t) => t.includes("Скрыть расшифровку"))).toBe(true);
  });
});
