import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createCustomCollection, getCollection, setCollectionClosed } from "../collections/collection-service";
import { listRecentAudit } from "../repo/audit";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * «Собрали, закрыть» кнопкой из напоминания бота.
 *
 * Бот сам просит дожать сбор — значит ответ на эту просьбу должен быть в том же
 * сообщении, а не в мини-аппе, которую надо открыть, найти сбор и раскрыть его
 * карточку.
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
    amountPerPerson: null, totalGoal: null, collectUrl: null, messageText: null, scheduledSendOn: null,
  });
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

describe("collection:close — кнопка «Собрали, закрыть»", () => {
  it("закрывает сбор и пишет в журнал", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 111, `collection:close:${collection.id}`);

    expect(getCollection(db, collection.id)!.closedAt).not.toBeNull();
    expect(listRecentAudit(db, 5)[0]!.type).toBe("collection_closed");
    expect(api.sent.map((m) => String(m.text)).join(" ")).toContain("Кофемашина");
  });

  it("не даёт закрыть сбор работнику", async () => {
    const { db, bot, collection } = stage();
    const api = recordApi(bot);

    await tap(bot, 333, `collection:close:${collection.id}`);

    expect(getCollection(db, collection.id)!.closedAt).toBeNull();
    expect(api.answers.join(" ")).toContain("админ");
  });

  it("на уже закрытый отвечает словами, а не молчанием", async () => {
    const { db, bot, collection } = stage();
    setCollectionClosed(db, collection.id, true, new Date());
    const api = recordApi(bot);

    await tap(bot, 111, `collection:close:${collection.id}`);

    expect(api.answers.join(" ")).toMatch(/уже закрыт/i);
    // Второе закрытие не пишет в журнал второй строкой: закрывали один раз.
    expect(listRecentAudit(db, 5).filter((e) => e.type === "collection_closed")).toHaveLength(0);
  });

  it("на удалённый сбор отвечает, а не падает", async () => {
    const { bot } = stage();
    const api = recordApi(bot);

    await tap(bot, 111, "collection:close:9999");

    expect(api.answers.join(" ")).toMatch(/удал/i);
  });
});
