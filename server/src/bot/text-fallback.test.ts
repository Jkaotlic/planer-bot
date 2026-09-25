import { describe, it, expect, vi, afterEach } from "vitest";
import { Bot } from "grammy";
import { recordApi, stubBotInfo } from "./testbot";
import { createBot, FALLBACK_TEXT } from "./bot";
import { BTN_ADMIN, BTN_WEEK } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin, archiveEmployee } from "../repo/employees";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * Раньше бот на любой текст, который не был меткой кнопки, ссылкой или
 * ожидаемым ответом (жалоба/сбор), просто молчал. Человек, задавший вопрос
 * прямо в чат, не получал вообще ничего — не «бот не понял», а тишина, которая
 * выглядит как зависший бот. `FALLBACK_TEXT` — тот самый ответ, и он же несёт
 * свежую клавиатуру взамен возможной старой (см. `planer-bot-open-questions`).
 */
const config = testConfig();

function testBot(db: Db) {
  const bot = stubBotInfo(createBot({ db, config }));
  const { calls } = recordApi(bot);
  return { bot, calls };
}

function linkedWorker(db: Db, tgId: number) {
  const employee = createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  return employee;
}

let updateId = 1;

function textUpdate(tgId: number, text: string, entities?: { type: "bot_command"; offset: number; length: number }[]) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      ...(entities ? { entities } : {}),
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

function keyboardLabels(payload: any): string[] | null {
  const kb = payload?.reply_markup?.keyboard;
  if (!kb) return null;
  return kb.flat().map((btn: { text: string }) => btn.text);
}

describe("ответ на обычный текст", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("привязанный работник получает подсказку с обычной клавиатурой", async () => {
    const db = makeTestDb();
    linkedWorker(db, 2001);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(2001, "можно поменяться в четверг?"));

    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.text).toBe(FALLBACK_TEXT);
    expect(keyboardLabels(sent[0]!.payload)).toContain(BTN_WEEK);
  });

  it("пять сообщений подряд в течение минуты получают один ответ", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    linkedWorker(db, 2002);
    const { bot, calls } = testBot(db);

    for (let i = 0; i < 5; i++) {
      await bot.handleUpdate(textUpdate(2002, `вопрос номер ${i}`));
    }

    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
  });

  it("через 61 секунду ответ уходит снова", async () => {
    vi.useFakeTimers();
    const db = makeTestDb();
    linkedWorker(db, 2005);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(2005, "первый вопрос"));
    vi.advanceTimersByTime(61_000);
    await bot.handleUpdate(textUpdate(2005, "второй вопрос"));

    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(2);
  });

  it("админ получает подсказку с кнопкой админки в клавиатуре", async () => {
    const db = makeTestDb();
    const admin = linkedWorker(db, 2006);
    setEmployeeAdmin(db, admin.id, true);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(2006, "а как посмотреть график другого человека?"));

    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toBe(FALLBACK_TEXT);
    expect(keyboardLabels(sent.payload)).toContain(BTN_ADMIN);
  });

  // `menuFor` намеренно прячет клавиатуру от незарегистрированного: жать ему
  // нечего, а «Мои смены» привели бы в мини-апп, который ответит 403. Подсказка
  // идёт тем же путём (`replyWithMenu`), что и весь остальной бот — второй копии
  // этого правила в файле быть не должно.
  it("незарегистрированный получает подсказку вовсе без клавиатуры", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(3001, "привет, кто вы?"));

    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toBe(FALLBACK_TEXT);
    expect(keyboardLabels(sent.payload)).toBeNull();
  });

  it("архивный получает подсказку вовсе без клавиатуры", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 3002);
    archiveEmployee(db, worker.id, "2026-01-01");
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(3002, "я всё ещё тут?"));

    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toBe(FALLBACK_TEXT);
    expect(keyboardLabels(sent.payload)).toBeNull();
  });

  it("неизвестная команда тоже получает подсказку — grammY не перехватывает её раньше", async () => {
    const db = makeTestDb();
    linkedWorker(db, 2003);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(
      textUpdate(2003, "/неизвестная_команда", [{ type: "bot_command", offset: 0, length: 20 }]),
    );

    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toBe(FALLBACK_TEXT);
  });

  it("сообщение со ссылкой по-прежнему уходит QR-кодом, а не подсказкой", async () => {
    const db = makeTestDb();
    linkedWorker(db, 2004);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(2004, "глянь https://example.com/x"));

    expect(calls.some((c) => c.method === "sendPhoto")).toBe(true);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });
});
