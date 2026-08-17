import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { BTN_BUG, BTN_WEEK } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { openBugPrompt, listBugReports } from "../bugs/bug-service";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

/**
 * Бот, чьи исходящие вызовы перехвачены, а не отправлены Telegram.
 *
 * `sendMessage`/`sendPhoto` отвечают возрастающим `message_id` — без него
 * `startBugReport` получил бы `undefined` от мока и не смог бы записать окно
 * ожидания (`promptMessageId` в базе — `NOT NULL`).
 */
function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const calls: { method: string; payload: any }[] = [];
  let nextMessageId = 5000;
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === "sendMessage" || method === "sendPhoto") {
      return { ok: true, result: { message_id: nextMessageId++ } } as any;
    }
    return { ok: true, result: {} } as any;
  });
  return { bot, calls };
}

/** Обычный работник с одной сменой — чтобы «График» было что рисовать. */
function worker(db: Db, name: string, tgId: number) {
  createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  return linkTelegramAccount(db, `inv-${tgId}`, tgId, "u", "T")!;
}

function admin(db: Db, name: string, tgId: number) {
  createEmployee(db, { displayName: name, inviteToken: `adm-${tgId}`, isAdmin: true });
  return linkTelegramAccount(db, `adm-${tgId}`, tgId, "a", "A")!;
}

/** Обычное текстовое сообщение — так и нажатая кнопка клавиатуры, и вольный текст. */
function textUpdate(tgId: number, text: string) {
  return {
    update_id: tgId * 10,
    message: {
      message_id: tgId * 10 + 1,
      date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Нажатие inline-кнопки — механика из reminders-toggle.test.ts. */
function tapUpdate(tgId: number, data: string) {
  return {
    update_id: tgId * 10 + 2,
    callback_query: {
      id: String(tgId),
      from: { id: tgId, is_bot: false, first_name: "T" },
      chat_instance: "1",
      data,
      message: {
        message_id: 9,
        date: 1_712_803_046,
        chat: { id: tgId, first_name: "T", type: "private" as const },
        text: "🐞 Марина: сломалось",
      },
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

describe("багрепорт из бота", () => {
  it("нажал «🐞 Проблема» → следующее сообщение легло в bug_reports и ушло админам", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 601);
    admin(db, "Игорь", 111);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(601, BTN_BUG));
    await bot.handleUpdate(textUpdate(601, "Кнопка «Больничный» не открывается"));

    const reports = listBugReports(db, "all");
    expect(reports).toHaveLength(1);
    expect(reports[0]!.report.text).toBe("Кнопка «Больничный» не открывается");
    expect(reports[0]!.report.employeeId).toBe(anya.id);

    // Ушло именно админу (111), с его именем-автором внутри текста.
    const toAdmin = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 111);
    expect(toAdmin?.payload.text).toContain("Кнопка «Больничный» не открывается");
    expect(toAdmin?.payload.text).toContain("Аня");
    // «Разобрал» — первой строкой, выключатель вида — второй (решение из брифа):
    // кнопка про конкретное сообщение важнее кнопки про поток вообще.
    const rows: Array<Array<{ callback_data: string }>> = toAdmin?.payload.reply_markup?.inline_keyboard ?? [];
    expect(rows[0]?.[0]?.callback_data).toBe(`bug:resolve:${reports[0]!.report.id}`);
    expect(rows[1]?.[0]?.callback_data).toBe("notice:mute:bug_reports");

    // Автору — подтверждение, а не тишина.
    const toAuthor = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 601 && String(c.payload.text).includes("Записал"));
    expect(toAuthor).toBeDefined();
  });

  it("нажал «🐞 Проблема» → написал «📅 График» → пришёл график, в bug_reports пусто", async () => {
    // Метка кнопки всегда остаётся кнопкой: передумавший человек, отправивший
    // «График», должен получить график, а не молча похоронить его в багах.
    const db = makeTestDb();
    worker(db, "Марк", 602);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(602, BTN_BUG));
    await bot.handleUpdate(textUpdate(602, BTN_WEEK));

    expect(listBugReports(db, "all")).toHaveLength(0);
    // sendWeek либо рисует фото, либо (если для пустой команды рисовать нечего)
    // отвечает текстом — в обоих случаях это НЕ ответ на багрепорт.
    const gotPhoto = calls.some((c) => c.method === "sendPhoto");
    const gotBugReplyInstead = calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("Записал"));
    expect(gotPhoto).toBe(true);
    expect(gotBugReplyInstead).toBe(false);
  });

  it("кнопку не нажимал → написал «привет» → в bug_reports пусто и бот промолчал", async () => {
    // Сегодня бот не отвечает на произвольный текст — эта работа не должна
    // это менять.
    const db = makeTestDb();
    worker(db, "Игорь", 603);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(603, "привет"));

    expect(listBugReports(db, "all")).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("окно старше 15 минут → сообщение не поймано", async () => {
    const db = makeTestDb();
    const marina = worker(db, "Марина", 604);
    // Окно открыто напрямую (в обход кнопки), чтобы управлять временем: кнопка
    // всегда штампует `new Date()` настоящих часов, а тесту нужно «16 минут назад».
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60_000);
    openBugPrompt(db, marina.id, 42, sixteenMinutesAgo);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(604, "Уже не важно, но всё равно не работало"));

    expect(listBugReports(db, "all")).toHaveLength(0);
    expect(calls).toEqual([]);
  });
});

describe("кнопка «Разобрал»", () => {
  // Отдельная проверка от `acting`, потому что кнопка живёт в чате вечно, а
  // админа могли разжаловать (решение из брифа) — обычный `isAdmin` в базе не
  // покрывает этот случай, аллоулист покрывает.
  it("админ отмечает багрепорт разобранным", async () => {
    const db = makeTestDb();
    worker(db, "Марина", 605);
    const igor = admin(db, "Игорь", 606);
    const { bot } = testBot(db);
    await bot.handleUpdate(textUpdate(605, BTN_BUG));
    await bot.handleUpdate(textUpdate(605, "сломалось"));
    const id = listBugReports(db, "all")[0]!.report.id;

    await bot.handleUpdate(tapUpdate(606, `bug:resolve:${id}`));

    const updated = listBugReports(db, "all")[0]!;
    expect(updated.report.resolvedAt).not.toBeNull();
    expect(updated.report.resolvedByEmployeeId).toBe(igor.id);
  });

  it("обычный работник «Разобрал» нажать не может", async () => {
    const db = makeTestDb();
    worker(db, "Марина", 607);
    worker(db, "Не-админ", 608);
    const { bot } = testBot(db);
    await bot.handleUpdate(textUpdate(607, BTN_BUG));
    await bot.handleUpdate(textUpdate(607, "сломалось"));
    const id = listBugReports(db, "all")[0]!.report.id;

    await bot.handleUpdate(tapUpdate(608, `bug:resolve:${id}`));

    expect(listBugReports(db, "all")[0]!.report.resolvedAt).toBeNull();
  });
});
