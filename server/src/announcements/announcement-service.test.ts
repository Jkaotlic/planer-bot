import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setRemindersEnabled } from "../repo/employees";
import { setNoticeMuted } from "../repo/notice-prefs";
import { ADMIN_NOTICE_KINDS } from "@planer/shared";
import { announcementText, announcementRecipients, sendAnnouncement } from "./announcement-service";
import type { Db } from "../db/client";

function testBot(failId?: number) {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { chat_id: number | string; text: string };
      if (p.chat_id === failId) throw new Error("telegram down");
      sent.push(p);
    }
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function linked(db: Db, name: string, tgId: number, isAdmin = false) {
  const e = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return e;
}

describe("анонс", () => {
  it("подписан отправителем — анонимной рассылке в рабочем чате нечего ответить", () => {
    // Без предлога «от»: он требует родительного падежа, а `addressOf` имя не
    // склоняет — «от Аня» читалось бы как сломанный русский при каждой
    // отправке. Разделитель «·» корректен для любого имени без падежа вообще.
    expect(announcementText("Аня", "В пятницу переезд")).toBe("📣 Объявление · Аня\n\nВ пятницу переезд");
  });

  it("уходит выбранным и не уходит остальным", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222);
    const marc = linked(db, "Марк", 333);
    linked(db, "Лена", 444);

    const { bot, sent } = testBot();
    const res = await sendAnnouncement(bot, db, {
      senderId: anya.id,
      text: "Собрание в 15:00",
      audience: { kind: "picked", employeeIds: [igor.id, marc.id] },
    });

    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 333]);
    expect(res).toMatchObject({ delivered: 2, intended: 2, unreachable: [] });
  });

  it("«всем» доходит до человека с выключенными напоминаниями и до оглохшего админа", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222, true);
    const marc = linked(db, "Марк", 333);
    setRemindersEnabled(db, marc.id, false);
    for (const kind of ADMIN_NOTICE_KINDS) setNoticeMuted(db, igor.id, kind, true);

    const { bot, sent } = testBot();
    await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    // Отправитель копию не получает — он секунду назад нажал кнопку.
    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 333]);
  });

  it("человек без Telegram попадает в unreachable, а не в delivered", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    createEmployee(db, { displayName: "Марк", inviteToken: "i-none" });
    linked(db, "Игорь", 222);

    const { bot } = testBot();
    const res = await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    expect(res.delivered).toBe(1);
    expect(res.unreachable).toEqual(["Марк"]);
  });

  it("недостижимый чат в середине не обрывает рассылку следующим", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    linked(db, "Игорь", 222);
    linked(db, "Марк", 333);
    linked(db, "Лена", 444);

    const { bot, sent } = testBot(333);
    const res = await sendAnnouncement(bot, db, { senderId: anya.id, text: "Переезд", audience: { kind: "all" } });

    expect(sent.map((m) => m.chat_id).sort()).toEqual([222, 444]);
    expect(res.delivered).toBe(2);
    expect(res.intended).toBe(3);
  });

  it("повтор id в picked не дублирует ни письмо, ни счётчики", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222);

    const { bot, sent } = testBot();
    const res = await sendAnnouncement(bot, db, {
      senderId: anya.id,
      text: "Собрание",
      audience: { kind: "picked", employeeIds: [igor.id, igor.id, igor.id] },
    });

    expect(sent).toHaveLength(1);
    expect(res).toMatchObject({ delivered: 1, intended: 1, unreachable: [] });
  });

  it("повтор id недостижимого в picked не дублирует имя в unreachable", () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const marc = createEmployee(db, { displayName: "Марк", inviteToken: "i-none" }); // без Telegram

    const picked = announcementRecipients(db, { kind: "picked", employeeIds: [marc.id, marc.id] }, anya.id);
    expect(picked.unreachable).toEqual(["Марк"]);
  });

  it("архивный не считается адресатом даже при явном выборе", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const marc = linked(db, "Марк", 333);
    const { archiveEmployee } = await import("../repo/employees");
    archiveEmployee(db, marc.id, "2026-08-17");

    const picked = announcementRecipients(db, { kind: "picked", employeeIds: [marc.id] }, anya.id);
    expect(picked.reachable).toEqual([]);
    expect(picked.unreachable).toEqual(["Марк"]);
  });
});
