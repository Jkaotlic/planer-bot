import { describe, it, expect } from "vitest";
import { recordApi, stubBotInfo } from "./testbot";
import { Bot } from "grammy";
import { notifyAdmins, notifyAdminsAlways } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { setNoticeMuted, isNoticeMuted, listMutedKinds } from "../repo/notice-prefs";
import { ADMIN_NOTICE_KINDS } from "@planer/shared";
import type { Db } from "../db/client";

function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 42, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
  return { bot, sent };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

describe("выключенные виды уведомлений", () => {
  it("по умолчанию не выключено ничего", () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    expect(isNoticeMuted(db, anya.id, "swaps")).toBe(false);
    expect(listMutedKinds(db, anya.id)).toEqual([]);
  });

  // Обе половины в одном тесте намеренно: тест, проверяющий только «выключивший
  // не получил», остаётся зелёным и при «не пишем вообще никому».
  it("выключивший вид не получает письмо, а не выключивший — получает", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    setNoticeMuted(db, anya.id, "self_entries", true);

    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "self_entries", "Игорь поставил себе больничный");

    expect(sent.map((m) => m.chat_id)).toEqual([222]);
  });

  it("выключен один вид — другие продолжают приходить", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    setNoticeMuted(db, anya.id, "self_entries", true);

    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "swaps", "Обмен состоялся");

    expect(sent.map((m) => m.chat_id)).toEqual([111]);
  });

  it("эскалация доходит до админа, у которого выключены все виды", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    for (const kind of ADMIN_NOTICE_KINDS) setNoticeMuted(db, anya.id, kind, true);

    const { bot, sent } = testBot();
    await notifyAdminsAlways(bot, db, "Смена без человека — нужно решение");

    expect(sent.map((m) => m.chat_id)).toEqual([111]);
  });

  it("выключенное у одного админа не выключается у другого", async () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    const igor = admin(db, "Игорь", 222);
    setNoticeMuted(db, anya.id, "weekend", true);

    expect(isNoticeMuted(db, igor.id, "weekend")).toBe(false);
  });

  it("повторное выключение не заводит вторую строку, включение убирает", () => {
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    setNoticeMuted(db, anya.id, "swaps", true);
    setNoticeMuted(db, anya.id, "swaps", true);
    expect(listMutedKinds(db, anya.id)).toEqual(["swaps"]);

    setNoticeMuted(db, anya.id, "swaps", false);
    expect(listMutedKinds(db, anya.id)).toEqual([]);
  });

  it("выключивший «дни рождения» выпадает из списка нуджей, а второй админ остаётся", async () => {
    const { adminRecipients } = await import("../collections/collection-service");
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    setNoticeMuted(db, anya.id, "celebrations", true);

    expect(adminRecipients(db, null).map((e) => e.displayName)).toEqual(["Игорь"]);
  });

  it("рассылка сбора команде выключателей не знает — от неё не отписываются", async () => {
    const { recipientsOf } = await import("../collections/collection-service");
    const db = makeTestDb();
    const anya = admin(db, "Аня", 111);
    setNoticeMuted(db, anya.id, "celebrations", true);

    expect(recipientsOf(db, null).map((e) => e.displayName)).toContain("Аня");
  });
});
