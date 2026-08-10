import { describe, it, expect, vi } from "vitest";
import { Bot } from "grammy";
import { notifyUser, notifyAdmins, notifyVacantSlot, swapProposalText, swapAcceptedAdminText, dutyNoticeForReceiver, dutyNoticeForAdmins } from "./notify";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee, setEmployeeRestrictions } from "../repo/employees";
import type { Db } from "../db/client";

function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

/** Like testBot, but sendMessage throws for the given chat_id (or for all sends, when "all"). */
function testBotFailing(failId: number | "all") {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { chat_id: number | string; text: string };
      if (failId === "all" || p.chat_id === failId) throw new Error("telegram down");
      sent.push(p);
    }
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

function admin(db: Db, name: string, tgId: number) {
  const a = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin: true });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return a;
}

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}` });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return w;
}

describe("notify", () => {
  it("notifyUser sends to the given telegram id and reports success", async () => {
    const { bot, sent } = testBot();
    await expect(notifyUser(bot, 999, "привет")).resolves.toBe(true);
    expect(sent).toEqual([{ chat_id: 999, text: "привет" }]);
  });

  it("notifyAdmins messages every linked active admin", async () => {
    const db = makeTestDb();
    admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    createEmployee(db, { displayName: "Работник" }); // non-admin, unlinked — must NOT be messaged
    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "обмен состоялся");
    expect(sent.map((s) => s.chat_id).sort()).toEqual([111, 222]);
    expect(sent.every((s) => s.text === "обмен состоялся")).toBe(true);
  });

  it("notifyAdmins keeps going (and does not throw) when one recipient fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    admin(db, "Аня", 111);
    admin(db, "Игорь", 222);
    const { bot, sent } = testBotFailing(111);
    try {
      await expect(notifyAdmins(bot, db, "обмен состоялся")).resolves.toBeUndefined();
      expect(sent.map((s) => s.chat_id)).toEqual([222]);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "notifyAdmins: failed for 111:",
        "telegram down",
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("notifyUser swallows a send failure instead of throwing, and reports it via the return value", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bot } = testBotFailing("all");
    try {
      await expect(notifyUser(bot, 999, "x")).resolves.toBe(false);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "notifyUser: failed for 999:",
        "telegram down",
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("notifyAdmins does not message an archived (inactive) admin", async () => {
    const db = makeTestDb();
    const inactive = admin(db, "Аня", 111);
    archiveEmployee(db, inactive.id, "2026-07-01");
    admin(db, "Игорь", 222);
    const { bot, sent } = testBot();
    await notifyAdmins(bot, db, "обмен состоялся");
    expect(sent.map((s) => s.chat_id)).toEqual([222]);
  });

  it("notifyVacantSlot skips excluded workers and does not count them as intended", async () => {
    const db = makeTestDb();
    worker(db, "Аня Смирнова", 111);
    const igor = worker(db, "Игорь Петров", 222);
    worker(db, "Марк Волков", 333);
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: true });
    const { bot, sent } = testBot();

    const result = await notifyVacantSlot(bot, db, 1, "Нужен человек на выходной");

    expect(sent.map((s) => s.chat_id).sort()).toEqual([111, 333]);
    expect(result).toEqual({ delivered: 2, intended: 2 });
  });

  it("the same slot reaches all three once the flag is cleared", async () => {
    const db = makeTestDb();
    worker(db, "Аня Смирнова", 111);
    const igor = worker(db, "Игорь Петров", 222);
    worker(db, "Марк Волков", 333);
    // Same shape as the excluded-worker test above, minus the exclusion.
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: true });
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: false });
    const { bot, sent } = testBot();

    const result = await notifyVacantSlot(bot, db, 1, "Нужен человек на выходной");

    expect(sent.map((s) => s.chat_id).sort()).toEqual([111, 222, 333]);
    expect(result).toEqual({ delivered: 3, intended: 3 });
  });
});

/**
 * Текст предложения жил литералом в `app.ts`, а не среди остальных билдеров.
 * Это ровно тот класс дефекта, про который написана шапка `notify.ts`: два
 * текста, которые «сегодня совпадают», расходятся на первой же правке. И
 * именно в это сообщение встаёт уведомление про пул — потому что именно на нём
 * висят кнопки, которыми обмен исполняется.
 */
const TRADE = {
  requestId: 1,
  fromEmployeeId: 1, fromName: "Аня", fromShift: "Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка",
  toEmployeeId: 2, toName: "Игорь", toShift: "Ср 12 авг · 10:00–19:00 · День",
};

describe("swapProposalText", () => {
  it("называет обе записи", () => {
    expect(swapProposalText(TRADE)).toBe(
      "«Аня предлагает обмен: отдаёт Ср 12 авг · 09:00–18:00 · Дежурство · Поклонка, хочет твою Ср 12 авг · 10:00–19:00 · День»",
    );
  });

  it("уведомления идут отдельным абзацем, чтобы их не проглядели над кнопками", () => {
    const text = swapProposalText(TRADE, ["⚠️ Что-то важное."]);
    expect(text.startsWith("«Аня предлагает обмен")).toBe(true);
    expect(text).toContain("\n\n⚠️ Что-то важное.");
  });

  it("без уведомлений ничего не приписывает", () => {
    expect(swapProposalText(TRADE, [])).toBe(swapProposalText(TRADE));
  });
});

describe("swapAcceptedAdminText", () => {
  // «Обмен сменами состоялся» рядом с дежурством в паре — просто неправда.
  it("не называет обмен обменом смен", () => {
    expect(swapAcceptedAdminText(TRADE)).not.toContain("сменами");
    expect(swapAcceptedAdminText(TRADE)).toContain("Аня");
    expect(swapAcceptedAdminText(TRADE)).toContain("Игорь");
  });

  it("уведомления приписывает хвостом, пустой список — нет", () => {
    expect(swapAcceptedAdminText(TRADE, ["⚠️ Хвост."])).toContain("⚠️ Хвост.");
    expect(swapAcceptedAdminText(TRADE, [])).toBe(swapAcceptedAdminText(TRADE));
  });
});

/** Один факт, две фразы: берущему — на «ты», админам — про третье лицо. */
describe("уведомление про пул дежурства", () => {
  const fact = { dutyName: "Дежурство · Поклонка", receiverName: "Игорь" };

  it("берущему — на «ты», с названием дежурства", () => {
    const text = dutyNoticeForReceiver(fact);
    expect(text).toContain("Дежурство · Поклонка");
    expect(text).toContain("Ты не в списке");
    expect(text).not.toContain("Игорь");
  });

  it("админам — про третье лицо, по имени", () => {
    const text = dutyNoticeForAdmins(fact);
    expect(text).toContain("Игорь");
    expect(text).toContain("Дежурство · Поклонка");
    expect(text).not.toContain("Ты не");
  });
});
