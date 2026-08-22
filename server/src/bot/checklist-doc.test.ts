import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { readChecklistSettings, saveChecklistDoc, startDocPending } from "../repo/checklist-settings";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * Приложить дежурным файл можно только через бота: браузер не умеет положить
 * документ в Telegram так, чтобы бот потом мог его переслать.
 */
const config = testConfig();

function stage() {
  const db: Db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  const worker = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  linkTelegramAccount(db, "inv-333", 333);
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, admin, worker };
}

let updateId = 1;

async function send(bot: Bot, from: number, message: Record<string, unknown>) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from, type: "private" },
      from: { id: from, is_bot: false, first_name: "T" },
      ...message,
    },
  } as never);
}

const DOC = { file_id: "BQACAgIAAx", file_unique_id: "u", file_name: "Проверка 47.pdf", file_size: 1024 };

describe("/instruction — приложить файл дежурным", () => {
  it("админу открывает окно и принимает следующий файл", async () => {
    const { db, bot } = stage();
    const sent = recordApi(bot);

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("Пришли файл");

    await send(bot, 111, { document: DOC });
    expect(readChecklistSettings(db)).toMatchObject({ docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
  });

  /**
   * Окно, а не «любой документ от админа»: админы шлют боту файлы и по другим
   * поводам, и молча превратить чужой PDF в инструкцию для всей смены нельзя.
   */
  it("файл без открытого окна инструкцией не становится", async () => {
    const { db, bot } = stage();
    recordApi(bot);
    await send(bot, 111, { document: DOC });
    expect(readChecklistSettings(db).docFileId).toBeNull();
  });

  it("окно чужое — файл не принимается", async () => {
    const { db, bot, worker } = stage();
    recordApi(bot);
    startDocPending(db, worker.id);
    await send(bot, 111, { document: DOC });
    expect(readChecklistSettings(db).docFileId).toBeNull();
  });

  it("работнику команда отказывает и окна не открывает", async () => {
    const { db, bot } = stage();
    const sent = recordApi(bot);
    await send(bot, 333, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("админы");

    await send(bot, 333, { document: DOC });
    expect(readChecklistSettings(db).docFileId).toBeNull();
  });

  it("когда файл уже приложен — называет его и предлагает убрать", async () => {
    const { db, bot, admin } = stage();
    saveChecklistDoc(db, { fileId: "OLD", fileName: "Старая инструкция.pdf" }, admin.id);
    const sent = recordApi(bot);

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    const text = sent.sent.map((m) => String(m.text)).join(" ");
    expect(text).toContain("Старая инструкция.pdf");
    const buttons = sent.sent.flatMap((m) => (m.reply_markup?.inline_keyboard ?? []).flat());
    expect(buttons.map((b) => (b as { text: string }).text).join(" ")).toContain("Убрать инструкцию");
  });

  it("новый файл заменяет прежний, а не копится", async () => {
    const { db, bot, admin } = stage();
    recordApi(bot);
    saveChecklistDoc(db, { fileId: "OLD", fileName: "Старая.pdf" }, admin.id);
    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await send(bot, 111, { document: DOC });
    expect(readChecklistSettings(db)).toMatchObject({ docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
  });

  it("второй файл подряд уже не принимается — окно закрылось", async () => {
    const { db, bot } = stage();
    recordApi(bot);
    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await send(bot, 111, { document: DOC });
    await send(bot, 111, { document: { ...DOC, file_id: "SECOND", file_name: "Другое.pdf" } });
    expect(readChecklistSettings(db).docFileId).toBe("BQACAgIAAx");
  });
});
