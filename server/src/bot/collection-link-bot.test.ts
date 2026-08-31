import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo, type SentMessage } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { ensureBirthdayRound, upcomingBirthdays } from "../birthdays/birthday-service";
import { updateCollection } from "../collections/collection-service";
import { linkPendingFor } from "../repo/link-pending";
import { testConfig } from "../test-config";
import { teamNow } from "../util/team-time";
import type { Db } from "../db/client";

/**
 * Ссылка на сбор, присланная боту в личку.
 *
 * Даты считаются от настоящего «сегодня»: бот берёт его из `teamNow`, и
 * зашитая в тест дата сделала бы тест сезонным.
 */
const config = testConfig();
const TODAY = teamNow(config.teamTz).date;

/** `YYYY-MM-DD` через `days` дней от `iso`. Своя арифметика, не из `shared`:
 *  тест, считающий ожидаемое той же функцией, что и код, пройдёт на любой. */
function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** «MM-DD» дня рождения через `days` дней. 29 февраля обходим: в невисокосный
 *  год оно считается за 1 марта, и «через 7» превратилось бы в «через 8». */
function birthDateIn(days: number): string {
  const iso = plusDays(TODAY, days);
  return iso.slice(5) === "02-29" ? plusDays(TODAY, days + 1).slice(5) : iso.slice(5);
}

/** `tg` — он же invite-токен: 333 намеренно НЕ в `ADMIN_TELEGRAM_IDS` (там 111). */
function person(db: Db, name: string, tg: number, birthDate: string | null, isAdmin = false): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${tg}` });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  if (isAdmin) setEmployeeAdmin(db, employee.id, true);
  return employee.id;
}

function stage() {
  const db: Db = makeTestDb();
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, api: recordApi(bot) };
}

function buttonsOf(message: SentMessage): string[] {
  return (message.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
}

let updateId = 1;

/** Обычное текстовое сообщение боту в личку. */
async function say(bot: Bot, from: number, text: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from, type: "private" },
      from: { id: from, is_bot: false, first_name: "T" },
      text,
    },
  } as never);
}

describe("ссылка на сбор, присланная боту в личку", () => {
  it("привязывается к единственному ждущему дню рождения и подтверждается текстом письма", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    person(db, "Игорь", 222, null, true);

    await say(bot, 222, "https://example.com/sbor");

    const birthday = upcomingBirthdays(db, TODAY).find((b) => b.displayName === "Марк")!;
    expect(birthday.campaign?.collectUrl).toBe("https://example.com/sbor");
    // Семь минус три: день считается от праздника, а не «через столько-то от сегодня».
    expect(birthday.campaign?.autoSendOn).toBe(plusDays(TODAY, 4));

    const reply = api.sent.find((m) => m.chat_id === 222)!;
    expect(reply.text).toContain("Марк");
    expect(reply.text).toContain("Сбор на подарок");
    expect(buttonsOf(reply)).toContain("🚫 Не рассылать сам");
  });

  it("молчит на ссылку от не-админа", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    person(db, "Аня", 333, null);

    await say(bot, 333, "https://example.com/sbor");

    expect(api.sent).toHaveLength(0);
  });

  it("молчит, когда ждущих сборов нет", async () => {
    const { db, bot, api } = stage();
    person(db, "Игорь", 222, null, true);

    await say(bot, 222, "https://example.com/sbor");

    expect(api.sent).toHaveLength(0);
  });

  it("молчит на текст без ссылки — так бот вёл себя всегда", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    person(db, "Игорь", 222, null, true);

    await say(bot, 222, "сделал сбор, скину позже");

    expect(api.sent).toHaveLength(0);
  });

  it("не даёт имениннику привязать ссылку к сбору на самого себя", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 222, birthDateIn(7), true);

    await say(bot, 222, "https://example.com/sbor");

    expect(api.sent).toHaveLength(0);
  });

  it("говорит остальным админам, что ссылка появилась, и молчит имениннику", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    person(db, "Игорь", 222, null, true);
    person(db, "Аня", 444, null, true);

    await say(bot, 222, "https://example.com/sbor");

    const toAnya = api.sent.find((m) => m.chat_id === 444)!;
    expect(toAnya.text).toContain("Игорь");
    expect(toAnya.text).toContain("делать ничего не надо");
    expect(api.sent.filter((m) => m.chat_id === 1)).toHaveLength(0);
  });

  it("спрашивает, к какому сбору, когда ждущих несколько, и пока ничего не привязывает", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    person(db, "Аня", 444, birthDateIn(10));
    const igor = person(db, "Игорь", 222, null, true);

    await say(bot, 222, "https://example.com/sbor");

    const ask = api.sent.find((m) => m.chat_id === 222)!;
    expect(ask.text).toContain("К какому сбору эта ссылка?");
    expect(buttonsOf(ask)).toEqual(["Марк", "Аня"]);
    // Ссылка ждёт ответа, а не лежит в `callback_data`: в 64 байта она не влезает.
    expect(linkPendingFor(db, igor)).toBe("https://example.com/sbor");
    // Просмотр кандидатов не пишет: раунда нет, пока привязки не было.
    expect(upcomingBirthdays(db, TODAY).every((b) => b.campaign === null)).toBe(true);
  });

  it("не подменяет молча готовую ссылку — спрашивает и помечает это заменой", async () => {
    const { db, bot, api } = stage();
    const mark = person(db, "Марк", 1, birthDateIn(7));
    person(db, "Игорь", 222, null, true);
    const round = ensureBirthdayRound(db, mark, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/staraya" });

    await say(bot, 222, "https://example.com/novaya");

    const ask = api.sent.find((m) => m.chat_id === 222)!;
    expect(buttonsOf(ask)).toEqual(["Марк · заменить ссылку"]);
    const birthday = upcomingBirthdays(db, TODAY).find((b) => b.displayName === "Марк")!;
    expect(birthday.campaign?.collectUrl).toBe("https://example.com/staraya");
  });
});
