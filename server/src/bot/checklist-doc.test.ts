import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createChecklist, getChecklist, listChecklists, updateChecklist } from "../repo/checklists";
import { startDocPending } from "../bugs/doc-pending";
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
  const list = createChecklist(db, "Обход 47-го");
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, admin, worker, list };
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

/** Имена чек-листов, к которым приложен файл. */
function listChecklistsDocs(db: Db): string[] {
  return listChecklists(db).filter((l) => l.docFileId != null).map((l) => l.name);
}

describe("/instruction — приложить файл дежурным", () => {
  /** Чек-листов несколько, поэтому команда сперва спрашивает, к какому именно. */
  it("спрашивает, к какому чек-листу, и принимает файл после выбора", async () => {
    const { db, bot, list } = stage();
    const sent = recordApi(bot);

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("К какому чек-листу");
    const buttons = sent.sent.flatMap((m) => (m.reply_markup?.inline_keyboard ?? []).flat());
    expect(buttons.map((b) => (b as { text: string }).text)).toContain("Обход 47-го");

    await tap(bot, 111, `checklist:doc:${list.id}`);
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("пришли файл");

    await send(bot, 111, { document: DOC });
    expect(getChecklist(db, list.id)).toMatchObject({ docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
  });

  /**
   * Файл кладётся в ТОТ чек-лист, который выбрали: у дежурного с семи и у
   * дежурного с восьми инструкции разные, и перепутать их — значит дать человеку
   * чужую процедуру.
   */
  it("кладёт файл в выбранный чек-лист, а не в первый попавшийся", async () => {
    const { db, bot } = stage();
    recordApi(bot);
    const second = createChecklist(db, "С 08:00");

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await tap(bot, 111, `checklist:doc:${second.id}`);
    await send(bot, 111, { document: DOC });

    expect(getChecklist(db, second.id)!.docFileId).toBe("BQACAgIAAx");
    expect(listChecklistsDocs(db)).toEqual(["С 08:00"]);
  });

  it("без единого чек-листа команда объясняет, чего не хватает", async () => {
    const db = makeTestDb();
    const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
    linkTelegramAccount(db, "inv-111", 111);
    expect(admin.id).toBeGreaterThan(0);
    const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
    const sent = recordApi(bot);

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("Сначала заведи чек-лист");
  });

  /**
   * Окно, а не «любой документ от админа»: админы шлют боту файлы и по другим
   * поводам, и молча превратить чужой PDF в инструкцию для всей смены нельзя.
   */
  it("файл без открытого окна инструкцией не становится", async () => {
    const { db, bot, list } = stage();
    recordApi(bot);
    await send(bot, 111, { document: DOC });
    expect(getChecklist(db, list.id)!.docFileId).toBeNull();
  });

  it("окно чужое — файл не принимается", async () => {
    const { db, bot, worker, list } = stage();
    recordApi(bot);
    startDocPending(db, worker.id, list.id);
    await send(bot, 111, { document: DOC });
    expect(getChecklist(db, list.id)!.docFileId).toBeNull();
  });

  it("работнику команда отказывает и окна не открывает", async () => {
    const { db, bot, list } = stage();
    const sent = recordApi(bot);
    await send(bot, 333, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    expect(sent.sent.map((m) => String(m.text)).join(" ")).toContain("админы");

    await send(bot, 333, { document: DOC });
    expect(getChecklist(db, list.id)!.docFileId).toBeNull();
  });

  it("когда файл уже приложен — называет его и предлагает убрать", async () => {
    const { db, bot, list } = stage();
    updateChecklist(db, list.id, { docFileId: "OLD", docName: "Старая инструкция.pdf" });
    const sent = recordApi(bot);

    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await tap(bot, 111, `checklist:doc:${list.id}`);
    const text = sent.sent.map((m) => String(m.text)).join(" ");
    expect(text).toContain("Старая инструкция.pdf");
    const buttons = sent.sent.flatMap((m) => (m.reply_markup?.inline_keyboard ?? []).flat());
    expect(buttons.map((b) => (b as { text: string }).text).join(" ")).toContain("Убрать файл");

    await tap(bot, 111, `checklist:docclear:${list.id}`);
    expect(getChecklist(db, list.id)!.docFileId).toBeNull();
  });

  it("новый файл заменяет прежний, а не копится", async () => {
    const { db, bot, list } = stage();
    recordApi(bot);
    updateChecklist(db, list.id, { docFileId: "OLD", docName: "Старая.pdf" });
    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await tap(bot, 111, `checklist:doc:${list.id}`);
    await send(bot, 111, { document: DOC });
    expect(getChecklist(db, list.id)).toMatchObject({ docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });
  });

  it("второй файл подряд уже не принимается — окно закрылось", async () => {
    const { db, bot, list } = stage();
    recordApi(bot);
    await send(bot, 111, { text: "/instruction", entities: [{ type: "bot_command", offset: 0, length: 12 }] });
    await tap(bot, 111, `checklist:doc:${list.id}`);
    await send(bot, 111, { document: DOC });
    await send(bot, 111, { document: { ...DOC, file_id: "SECOND", file_name: "Другое.pdf" } });
    expect(getChecklist(db, list.id)!.docFileId).toBe("BQACAgIAAx");
  });
});
