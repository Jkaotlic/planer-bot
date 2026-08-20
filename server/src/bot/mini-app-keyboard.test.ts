import { describe, it, expect } from "vitest";
import { recordApi, stubBotInfo } from "./testbot";
import { createBot } from "./bot";
import { BTN_MY_SHIFTS } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeObserver, setSelfScheduleEnabled } from "../repo/employees";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

/** Same shape as `bot.test.ts`'s `testBot`, kept local: this file only needs
 *  the raw `sendMessage` payload (to read `reply_markup`), not the trimmed
 *  `{chat_id, text}` view the shared helper elsewhere returns. */
function testBot(db: Db) {
  const bot = stubBotInfo(createBot({ db, config }));
  const { calls } = recordApi(bot);
  return { bot, calls };
}

function myShiftsTap(tgId: number) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: tgId, is_bot: false, first_name: "T" },
      chat: { id: tgId, first_name: "T", type: "private" as const },
      date: 1_712_803_046,
      text: BTN_MY_SHIFTS,
    },
  };
}

/** Labels of every `web_app` button across all rows, flattened — row order
 *  isn't this test's concern, only which buttons exist. */
function webAppLabels(markup: unknown): string[] {
  const rows = (markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] }).inline_keyboard;
  return rows.flat().filter((btn) => btn.web_app).map((btn) => btn.text);
}

describe("вход в мини-апп по кнопке «Мои смены»: третья строка «📣 Анонс» — только у админов", () => {
  it("админу (isAdmin в базе) добавляет кнопку анонсов", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня Смирнова", inviteToken: "a", isAdmin: true });
    linkTelegramAccount(db, "a", 222);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(222));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    expect(webAppLabels(reply!.payload.reply_markup)).toContain("📣 Анонс");
  });

  it("аллоулистнутому по ADMIN_TELEGRAM_IDS — тем же правилом, что и мейн-клавиатура", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь Петров", inviteToken: "boss" });
    linkTelegramAccount(db, "boss", 111); // 111 ∈ config.adminTelegramIds
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(111));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(webAppLabels(reply!.payload.reply_markup)).toContain("📣 Анонс");
  });

  it("обычному работнику кнопку анонсов не даёт — единственный ответ был бы 403", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Марк Волков", inviteToken: "m" });
    linkTelegramAccount(db, "m", 333);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(333));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    expect(webAppLabels(reply!.payload.reply_markup)).not.toContain("📣 Анонс");
    // Смены и обе формы самозаписи остаются — эта строка не про их отсутствие.
    expect(webAppLabels(reply!.payload.reply_markup)).toEqual(["📋 Открыть смены", "🤒 Больничный", "📌 Мероприятие"]);
  });
});

describe("наблюдателю кнопка анонса видна не по флагу isAdmin, а по canAnnounce", () => {
  it("наблюдателю (isObserver=true, isAdmin=false) кнопка анонса видна", async () => {
    const db = makeTestDb();
    const daria = createEmployee(db, { displayName: "Даша Орлова", inviteToken: "d" });
    setEmployeeObserver(db, daria.id, true);
    linkTelegramAccount(db, "d", 444);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(444));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    // Держит `canAnnounce`, а не `isAdmin`: у этого человека isAdmin=false, и
    // старое условие `if (opts.isAdmin)` эту кнопку не показало бы вовсе.
    expect(webAppLabels(reply!.payload.reply_markup)).toContain("📣 Анонс");
  });
});

describe("наблюдателю с включённым тумблером «Веду свой график сам» — кнопка «📅 Своя смена»", () => {
  it("тумблер включён — кнопка есть, рядом с больничным и мероприятием", async () => {
    const db = makeTestDb();
    const nina = createEmployee(db, { displayName: "Нина Соколова", inviteToken: "n" });
    setEmployeeObserver(db, nina.id, true);
    setSelfScheduleEnabled(db, nina.id, true);
    linkTelegramAccount(db, "n", 555);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(555));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    expect(webAppLabels(reply!.payload.reply_markup)).toContain("📅 Своя смена");
  });

  // Парный отрицательный случай: роли наблюдателя одной недостаточно — нужен
  // ещё и включённый тумблер, иначе кнопка вела бы на форму, которая ответит
  // «Такую запись ставит админ» на каждое нажатие.
  it("роль есть, тумблер выключен — кнопки нет", async () => {
    const db = makeTestDb();
    const oleg = createEmployee(db, { displayName: "Олег Быков", inviteToken: "o" });
    setEmployeeObserver(db, oleg.id, true);
    linkTelegramAccount(db, "o", 666);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(666));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    expect(webAppLabels(reply!.payload.reply_markup)).not.toContain("📅 Своя смена");
  });

  it("обычному работнику (не наблюдателю) кнопки тоже нет", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Павел Титов", inviteToken: "p" });
    linkTelegramAccount(db, "p", 777);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(myShiftsTap(777));

    const reply = calls.find((c) => c.method === "sendMessage" && c.payload.text === "Что открыть:");
    expect(reply).toBeDefined();
    expect(webAppLabels(reply!.payload.reply_markup)).not.toContain("📅 Своя смена");
  });
});
