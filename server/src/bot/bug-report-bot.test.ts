import { describe, it, expect } from "vitest";
import { stubBotInfo, type ApiCall } from "./testbot";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { BTN_BUG, BTN_WEEK } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { openBugPrompt, listBugReports, getBugPending } from "../bugs/bug-service";
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
  // Транспорт свой, а не `recordApi`: багрепорт запоминает `message_id` ответа
  // (по нему потом дописывается «Разобрал»), поэтому отправка обязана отдавать
  // растущий id, а не пустой результат. Подделка `botInfo` общая.
  //
  // `messageId` на каждой записи — сверх того, что даёт общий `ApiCall`: тест
  // на регресс «реплай на последнее сообщение» (ниже) обязан реплаить на id,
  // который бот выдал НА САМОМ ДЕЛЕ, а не на угаданный по счётчику.
  const bot = stubBotInfo(createBot({ db, config }));
  const calls: Array<ApiCall & { messageId?: number }> = [];
  let nextMessageId = 5000;
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage" || method === "sendPhoto") {
      const messageId = nextMessageId++;
      calls.push({ method, payload, messageId });
      return { ok: true, result: { message_id: messageId } } as never;
    }
    calls.push({ method, payload });
    return { ok: true, result: {} } as never;
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

/** Как `textUpdate`, но явный свайп-реплай на конкретное сообщение — так
 *  Telegram помечает ответ, когда человек отвечает не в поле ввода, а свайпом
 *  по сообщению в чате. */
function replyUpdate(tgId: number, text: string, replyToMessageId: number) {
  return {
    update_id: tgId * 10 + 3,
    message: {
      message_id: tgId * 10 + 1,
      date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      reply_to_message: { message_id: replyToMessageId },
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

describe("ответ «Записал» возвращает раскладку", () => {
  it("ответ «Записал» несёт раскладку — обычный путь не заканчивается пропавшими кнопками", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 611);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(611, BTN_BUG));
    await bot.handleUpdate(textUpdate(611, "Кнопка не нажимается"));

    const confirmation = calls.filter((c) => c.method === "sendMessage").find((c) => String(c.payload.text).includes("Записал"))!;
    const labels = (confirmation.payload.reply_markup?.keyboard ?? []).flat().map((b: { text: string }) => b.text);
    expect(labels).toContain(BTN_WEEK);
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

describe("выход из багрепорта", () => {
  it("«🏠 В меню» гасит окно: следующее сообщение уже не становится багрепортом", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 621);
    const { bot } = testBot(db);

    await bot.handleUpdate(textUpdate(621, BTN_BUG));
    await bot.handleUpdate(tapUpdate(621, "bug:cancel"));
    await bot.handleUpdate(textUpdate(621, "просто пишу коллеге"));

    expect(getBugPending(db, anya.id)).toBeNull();
    expect(listBugReports(db, "all")).toHaveLength(0);
  });

  it("«🏠 В меню» присылает новое сообщение с раскладкой — правкой старого её не вернуть", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 622);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(622, BTN_BUG));
    const before = calls.filter((c) => c.method === "sendMessage").length;
    await bot.handleUpdate(tapUpdate(622, "bug:cancel"));

    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent.length).toBe(before + 1);
    const labels = (sent.at(-1)!.payload.reply_markup?.keyboard ?? []).flat().map((b: { text: string }) => b.text);
    expect(labels).toContain(BTN_WEEK);
  });

  // Развилка из брифа: Telegram не разрешает `force_reply` и `inline_keyboard`
  // в одном `reply_markup` — это одно поле (см. @grammyjs/types methods.d.ts,
  // `reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply`),
  // а не два. Поэтому кнопка выхода едет ПЕРВЫМ сообщением, а вопрос с
  // `force_reply` — ВТОРЫМ и последним: свайп-реплай на последнее сообщение в
  // чате — обычный жест, и обязан попасть на вопрос, а не на кнопку (см.
  // следующий тест — что случается, когда это не так).
  it("кнопка выхода едет первым сообщением, вопрос с force_reply — последним", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 623);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(623, BTN_BUG));

    const sent = calls.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(2);
    const data = (sent[0]!.payload.reply_markup?.inline_keyboard ?? []).flat().map((b: { callback_data: string }) => b.callback_data);
    expect(data).toContain("bug:cancel");
    expect(sent[1]!.payload.reply_markup.force_reply).toBe(true);
  });

  it("реплай на последнее из двух сообщений после «🐞 Проблема» не теряется молча", async () => {
    // Регресс из ревью: до правки порядка последним в чате уходило кнопочное
    // сообщение («Если передумал…»), а не вопрос. Человек, свернувший чат и
    // вернувшийся позже, свайпает реплай на ПОСЛЕДНЕЕ сообщение — Telegram
    // всегда подставляет его id. Раньше это id не совпадал с promptMessageId,
    // shouldCapture молча возвращал false, и жалоба исчезала: ни записи в
    // базе, ни ответа автору. Тест реплаит на фактическое последнее сообщение,
    // каким бы оно ни было, — поэтому падает на старом порядке и проходит на
    // новом без всякой правки самого теста.
    const db = makeTestDb();
    const anya = worker(db, "Аня", 624);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(textUpdate(624, BTN_BUG));
    const sentSoFar = calls.filter((c) => c.method === "sendMessage");
    const lastMessageId = sentSoFar.at(-1)!.messageId!;

    await bot.handleUpdate(replyUpdate(624, "Кнопка «Больничный» не открывается", lastMessageId));

    const reports = listBugReports(db, "all");
    expect(reports).toHaveLength(1);
    expect(reports[0]!.report.employeeId).toBe(anya.id);
  });
});
