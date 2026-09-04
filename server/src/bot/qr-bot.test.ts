import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { createBot } from "./bot";
import { recordApi, stubBotInfo, type ApiCall, type SentMessage } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { ensureBirthdayRound, upcomingBirthdays } from "../birthdays/birthday-service";
import { updateCollection } from "../collections/collection-service";
import { linkPendingFor } from "../repo/link-pending";
import { openBugPrompt } from "../bugs/bug-service";
import { testConfig } from "../test-config";
import { teamNow } from "../util/team-time";
import { QR_MAX_TEXT_LENGTH } from "./qr-image";
import type { Db } from "../db/client";

/**
 * QR-код по присланной ссылке.
 *
 * Тот же приём, что в `collection-link-bot.test.ts`: даты — от настоящего
 * «сегодня», а картинка проверяется сканером, а не по имени файла.
 */
const config = testConfig();
const TODAY = teamNow(config.teamTz).date;

function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function birthDateIn(days: number): string {
  return plusDays(TODAY, days).slice(5);
}

/** 333 намеренно НЕ в `ADMIN_TELEGRAM_IDS` (там 111). */
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

function photos(calls: ApiCall[]): ApiCall[] {
  return calls.filter((c) => c.method === "sendPhoto");
}

/** Что зашито в отправленной картинке — глазами сканера. */
async function decodePhoto(call: ApiCall): Promise<string | null> {
  // `InputFile` grammy отдаёт байты через `toRaw`, а не как поле; в тесте это единственный путь к ним.
  const raw = await call.payload.photo.toRaw();
  const image = PNG.sync.read(Buffer.from(raw));
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

let updateId = 1;

async function say(bot: Bot, from: number, text: string, chatType: "private" | "group" = "private") {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from, type: chatType },
      from: { id: from, is_bot: false, first_name: "T" },
      text,
    },
  } as never);
}

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

describe("QR-код по ссылке от сотрудника", () => {
  it("отвечает картинкой с этой ссылкой и ссылкой в подписи", async () => {
    const { db, bot, api } = stage();
    person(db, "Аня", 333, null);

    await say(bot, 333, "https://example.com/menu");

    const [photo] = photos(api.calls);
    expect(photo).toBeDefined();
    expect(photo!.payload.chat_id).toBe(333);
    expect(photo!.payload.caption).toBe("https://example.com/menu");
    expect(await decodePhoto(photo!)).toBe("https://example.com/menu");
  });

  it("вынимает ссылку из текста вокруг неё", async () => {
    const { db, bot, api } = stage();
    person(db, "Аня", 333, null);

    await say(bot, 333, "сделай qr https://example.com/menu, пожалуйста");

    expect(await decodePhoto(photos(api.calls)[0]!)).toBe("https://example.com/menu");
  });

  it("молчит чужому, архивному и в группе", async () => {
    const { db, bot, api } = stage();
    const anya = person(db, "Аня", 333, null);
    archiveEmployee(db, anya, TODAY);

    await say(bot, 333, "https://example.com/menu");
    await say(bot, 555, "https://example.com/menu");
    person(db, "Марк", 444, null);
    await say(bot, 444, "https://example.com/menu", "group");

    expect(photos(api.calls)).toHaveLength(0);
    expect(api.sent).toHaveLength(0);
  });

  it("на слишком длинную ссылку отвечает словами, а не картинкой", async () => {
    const { db, bot, api } = stage();
    person(db, "Аня", 333, null);

    await say(bot, 333, `https://example.com/${"a".repeat(QR_MAX_TEXT_LENGTH)}`);

    expect(photos(api.calls)).toHaveLength(0);
    expect(api.sent[0]!.text).toContain("длинн");
  });

  it("не перехватывает ссылку, когда у автора открыт вопрос про баг", async () => {
    const { db, bot, api } = stage();
    const anya = person(db, "Аня", 333, null);
    openBugPrompt(db, anya, 42, new Date());

    await say(bot, 333, "не открывается https://example.com/app");

    expect(photos(api.calls)).toHaveLength(0);
  });
});

describe("ссылка от админа, когда рядом день рождения", () => {
  it("не привязывает молча к единственному ждущему сбору — спрашивает и предлагает QR", async () => {
    const { db, bot, api } = stage();
    const mark = person(db, "Марк", 1, birthDateIn(7));
    const igor = person(db, "Игорь", 222, null, true);
    const round = ensureBirthdayRound(db, mark, TODAY)!;
    updateCollection(db, round.id, { autoSendOn: null });

    await say(bot, 222, "https://example.com/sbor");

    const ask = api.sent.find((m) => m.chat_id === 222)!;
    expect(ask.text).toContain("К какому сбору");
    expect(buttonsOf(ask)).toEqual(["Марк", "Просто QR-код"]);
    expect(linkPendingFor(db, igor)).toBe("https://example.com/sbor");
    expect(photos(api.calls)).toHaveLength(0);
    const birthday = upcomingBirthdays(db, TODAY).find((b) => b.displayName === "Марк")!;
    expect(birthday.campaign?.collectUrl ?? null).toBeNull();
  });

  it("после «Просто QR-код» рисует картинку и ничего к сбору не привязывает", async () => {
    const { db, bot, api } = stage();
    person(db, "Марк", 1, birthDateIn(7));
    const igor = person(db, "Игорь", 222, null, true);

    await say(bot, 222, "https://example.com/sbor");
    await tap(bot, 222, "collection:qr");

    const [photo] = photos(api.calls);
    expect(await decodePhoto(photo!)).toBe("https://example.com/sbor");
    expect(linkPendingFor(db, igor)).toBeNull();
    expect(upcomingBirthdays(db, TODAY).every((b) => b.campaign === null)).toBe(true);
  });

  it("«Просто QR-код» без ждущей ссылки честно просит прислать её заново", async () => {
    const { db, bot, api } = stage();
    person(db, "Игорь", 222, null, true);

    await tap(bot, 222, "collection:qr");

    expect(photos(api.calls)).toHaveLength(0);
    expect(api.sent.at(-1)!.text).toContain("Пришли ссылку ещё раз");
  });

  it("вне окна дня рождения админ получает QR сразу", async () => {
    const { db, bot, api } = stage();
    person(db, "Игорь", 222, null, true);

    await say(bot, 222, "https://example.com/menu");

    expect(await decodePhoto(photos(api.calls)[0]!)).toBe("https://example.com/menu");
  });
});
