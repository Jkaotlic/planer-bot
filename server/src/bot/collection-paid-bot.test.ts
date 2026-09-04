import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { collectionPaidKeyboard } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import {
  createCustomCollection,
  markCollectionSent,
  setCollectionClosed,
} from "../collections/collection-service";
import { listPayments } from "../collections/payment-service";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * «Я перевёл» кнопкой под письмом сбора.
 *
 * Письмо со ссылкой человек читает в боте, по ссылке переводит из бота — и
 * отметиться должен там же, а не «открой мини-апп, вкладка „Сборы“, найди
 * карточку». Правила те же, что у ручки `/api/collections/:id/paid`: только
 * участник, только пока сбор виден (разослан и идёт), закрытый заморожен.
 */
const config = testConfig();

function stage() {
  const db: Db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  const worker = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  linkTelegramAccount(db, "inv-333", 333);
  const collection = createCustomCollection(db, {
    title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
    amountPerPerson: null, totalGoal: null, collectUrl: "https://example.com/sbor", messageText: null, scheduledSendOn: null,
  });
  // Разослан: до рассылки сбор — черновик админа, и отметиться в нём нельзя.
  markCollectionSent(db, collection.id, 2, new Date());
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, admin, worker, collection };
}

let updateId = 1;

/** Нажатие inline-кнопки. */
async function tap(bot: Bot, from: number, data: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: { id: from, is_bot: false, first_name: "T" },
      chat_instance: "1",
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: from, type: "private" },
        from: { id: 1, is_bot: true, first_name: "P" },
        text: "…",
      },
    },
  } as never);
}

/** Тексты кнопок, которыми бот заменил клавиатуру под нажатым сообщением. */
function editedButtons(api: ReturnType<typeof recordApi>): string[] {
  return api.calls
    .filter((call) => call.method === "editMessageReplyMarkup")
    .flatMap((call) => (call.payload.reply_markup?.inline_keyboard ?? []).flat().map((b: { text: string }) => b.text));
}

describe("collection:paid — кнопка «Я перевёл»", () => {
  it("ставит свою галочку и меняет кнопку на «отметились»", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 333, `collection:paid:${collection.id}`);

    expect(listPayments(db, collection).paidCount).toBe(1);
    expect(api.answers.join(" ")).toMatch(/отметил/i);
    expect(editedButtons(api).join(" ")).toMatch(/отметились/i);
  });

  it("второе нажатие не снимает галочку, а говорит, где её снять", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 333, `collection:paid:${collection.id}`);
    await tap(bot, 333, `collection:paid:${collection.id}`);

    expect(listPayments(db, collection).paidCount).toBe(1);
    expect(api.answers[1]).toMatch(/уже/i);
    expect(api.answers[1]).toMatch(/мини-апп/i);
  });

  it("админ тоже участник: его галочка ставится так же", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 111, `collection:paid:${collection.id}`);

    expect(listPayments(db, collection).paidCount).toBe(1);
    expect(api.answers.join(" ")).toMatch(/отметил/i);
  });

  it("закрытый сбор отметку не принимает", async () => {
    const { db, bot, collection } = stage();
    setCollectionClosed(db, collection.id, true, new Date());
    const api = recordApi(bot);

    await tap(bot, 333, `collection:paid:${collection.id}`);

    expect(listPayments(db, collection).paidCount).toBe(0);
    expect(api.answers.join(" ")).toMatch(/закрыт/i);
  });

  it("на удалённый сбор отвечает, а не падает", async () => {
    const { bot } = stage();
    const api = recordApi(bot);

    await tap(bot, 333, "collection:paid:9999");

    expect(api.answers.join(" ")).toMatch(/удал/i);
  });

  it("чужой для системы человек получает отказ словами", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 999, `collection:paid:${collection.id}`);

    expect(listPayments(db, collection).paidCount).toBe(0);
    expect(api.answers.join(" ")).toMatch(/не в системе/i);
  });

  it("клавиатура письма ведёт ровно на этот колбэк", () => {
    const buttons = collectionPaidKeyboard(7).inline_keyboard.flat();
    expect(buttons.map((b) => ("callback_data" in b ? b.callback_data : ""))).toEqual(["collection:paid:7"]);
    expect(buttons[0]!.text).toContain("Я перевёл");
  });
});
