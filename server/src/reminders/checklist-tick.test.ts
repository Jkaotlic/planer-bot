import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { createChecklistItem, setMark, updateChecklistItem } from "../repo/checklist";
import { saveChecklistDoc, saveChecklistText } from "../repo/checklist-settings";
import { shiftTemplates } from "../db/schema";
import { eq } from "drizzle-orm";
import { testConfig } from "../test-config";
import { runChecklistTick } from "./checklist-tick";
import type { Db } from "../db/client";

const config = testConfig();

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const docs: { to: number; fileId: string; caption?: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }),
      sendDocument: vi.fn(async (to: number, fileId: string, extra?: { caption?: string }) => {
        docs.push({ to, fileId, caption: extra?.caption });
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent, docs };
}

const TODAY = "2026-08-24";

/** Дежурный с чек-листом: пресет отмечен галочкой, смена с 07:00 стоит на сегодня. */
function stage(opts: { items?: string[]; remindersEnabled?: boolean; linked?: boolean } = {}) {
  const db: Db = makeTestDb();
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-1" });
  if (opts.linked !== false) linkTelegramAccount(db, "inv-1", 333);
  if (opts.remindersEnabled === false) {
    db.run(`update employees set reminders_enabled = 0 where id = ${igor.id}` as never);
  }
  const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
  db.update(shiftTemplates).set({ requiresChecklist: true }).where(eq(shiftTemplates.id, duty.id)).run();
  createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: duty.id });
  for (const title of opts.items ?? ["Свет", "Окна"]) createChecklistItem(db, title);
  return { db, igor, duty };
}

describe("runChecklistTick", () => {
  it("присылает дежурному список пунктов после начала смены", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    const count = await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(333);
    expect(sent[0]!.text).toContain("Свет");
    expect(sent[0]!.text).toContain("Окна");
  });

  // Смена начинается в 07:00; в 06:30 человек ещё не на этаже, и проверять нечего.
  it("не пишет до начала смены", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "06:30" })).toBe(0);
    expect(sent).toEqual([]);
  });

  // Тик крутится каждые пять минут: без дедупликации это два десятка сообщений за смену.
  it("шлёт одно сообщение на человека в день, сколько бы раз ни крутился", async () => {
    const { db } = stage();
    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "09:00" });
    expect(sent).toHaveLength(1);
  });

  it("молчит, пока в чек-листе нет ни одного пункта", async () => {
    const { db } = stage({ items: [] });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("молчит тому, кто выключил себе напоминания", async () => {
    const { db } = stage({ remindersEnabled: false });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("молчит тому, кто не привязал телеграм", async () => {
    const { db } = stage({ linked: false });
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("не пишет тому, чей вид смены галочки не несёт", async () => {
    const { db, igor, duty } = stage();
    db.update(shiftTemplates).set({ requiresChecklist: false }).where(eq(shiftTemplates.id, duty.id)).run();
    expect(igor.id).toBeGreaterThan(0);
    const { bot, sent } = fakeBot();
    expect(await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" })).toBe(0);
    expect(sent).toEqual([]);
  });

  // Человек мог начать в мини-аппе и открыть чат: сообщение обязано показывать
  // уже сделанное сделанным, иначе оно спорит с экраном.
  it("показывает уже отмеченные пункты отмеченными", async () => {
    const { db, igor } = stage();
    const item = createChecklistItem(db, "Двери");
    setMark(db, { date: TODAY, employeeId: igor.id, itemId: item.id, done: true });
    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(sent[0]!.text).toContain("✅ Двери");
    expect(sent[0]!.text).toContain("◻️ Свет");
    expect(sent[0]!.text).toContain("1 из 3");
  });

  it("кладёт в сообщение общее пояснение и пояснения пунктов", async () => {
    const { db } = stage({ items: [] });
    const item = createChecklistItem(db, "Обойти этаж");
    updateChecklistItem(db, item.id, { note: "По часовой, от лифтов" });
    saveChecklistText(db, { note: "Начинаем с 47-го", docUrl: null }, 1);

    const { bot, sent } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(sent[0]!.text).toContain("Начинаем с 47-го");
    expect(sent[0]!.text).toContain("По часовой, от лифтов");
  });

  // Файл живёт в Telegram и пересылается по `file_id`: своё хранилище ради
  // одного PDF означало бы бэкапы, права и чистку — всё то, что Telegram делает сам.
  it("присылает приложенный файл вместе с чек-листом", async () => {
    const { db } = stage();
    saveChecklistDoc(db, { fileId: "BQACAgIAAx", fileName: "Проверка 47.pdf" }, 1);
    const { bot, sent, docs } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ to: 333, fileId: "BQACAgIAAx" });
    expect(sent).toHaveLength(1);
  });

  it("файла нет — документ не шлётся вовсе", async () => {
    const { db } = stage();
    const { bot, docs } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    expect(docs).toEqual([]);
  });

  // Один файл в день, ровно как одно сообщение: тик крутится каждые пять минут.
  it("не шлёт файл повторно на следующем тике", async () => {
    const { db } = stage();
    saveChecklistDoc(db, { fileId: "BQACAgIAAx", fileName: "Проверка 47.pdf" }, 1);
    const { bot, docs } = fakeBot();
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });
    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:10" });
    expect(docs).toHaveLength(1);
  });

  it("ссылка на инструкцию едет кнопкой, а не текстом в теле", async () => {
    const { db } = stage();
    saveChecklistText(db, { note: null, docUrl: "https://disk.example/47.pdf" }, 1);
    const bot = fakeBot();
    const calls: unknown[] = [];
    (bot.bot as unknown as { api: { sendMessage: (...a: unknown[]) => Promise<void> } }).api.sendMessage =
      async (...args: unknown[]) => { calls.push(args); };

    await runChecklistTick(db, bot.bot, config, { date: TODAY, time: "07:05" });
    const [, text, extra] = calls[0] as [number, string, { reply_markup?: { inline_keyboard: { text: string; url?: string }[][] } }];
    expect(text).not.toContain("https://disk.example/47.pdf");
    const urls = extra.reply_markup!.inline_keyboard.flat().filter((b) => b.url);
    expect(urls.map((b) => b.url)).toContain("https://disk.example/47.pdf");
  });
});
