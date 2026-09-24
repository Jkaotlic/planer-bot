import { describe, expect, it } from "vitest";
import { openDb, runMigrations } from "../db/client";
import { makeTestDb } from "../db/testdb";
import { testConfig } from "../test-config";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";

function tap(data: string) {
  return {
    update_id: 9,
    callback_query: {
      id: "cbq-stale",
      from: { id: 202, is_bot: false, first_name: "T" },
      message: { message_id: 5, date: 1_712_803_046, chat: { id: 202, first_name: "T", type: "private" as const }, text: "x" },
      chat_instance: "x",
      data,
    },
  };
}

describe("на любое нажатие кнопки бот отвечает", () => {
  it("кнопка из старого сообщения, чью callback_data переименовали, не крутит спиннер вечно", async () => {
    // `checklist:doc:clear` — подпись «🗑 Убрать инструкцию» до cdb74a2; такие
    // сообщения до сих пор лежат в чатах админов.
    const bot = stubBotInfo(createBot({ db: makeTestDb(), config: testConfig() }));
    const { answers } = recordApi(bot);

    await bot.handleUpdate(tap("checklist:doc:clear"));

    expect(answers).toEqual(["Кнопка устарела — открой свежее сообщение или /start"]);
  });

  it("обработчик упал до ответа — человек всё равно видит, что не получилось", async () => {
    const { db, sqlite } = openDb(":memory:");
    runMigrations(db, sqlite);
    const bot = stubBotInfo(createBot({ db, config: testConfig() }));
    const { answers } = recordApi(bot);
    sqlite.close(); // первое же обращение к базе в обработчике бросит

    // В опросе ошибку дальше ловит `bot.catch` (лог); здесь она просто всплывает.
    await expect(bot.handleUpdate(tap("handover:take:1"))).rejects.toThrow();

    expect(answers).toEqual(["Не получилось — попробуй ещё раз"]);
  });
});
