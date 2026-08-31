import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { runBirthdayNoticeTick } from "./birthday-notice";
import { ensureBirthdayRound, markAdminNotified } from "./birthday-service";
import {
  claimCollectionSend,
  createCustomCollection,
  getCollection,
  markCollectionSent,
  releaseCollectionSend,
  updateCollection,
} from "../collections/collection-service";
import { collections } from "../db/schema";
import type { Db } from "../db/client";

const TODAY = "2026-08-01";
/** Момент после часа рассылки — «обычный» вход в тик. */
const NOW = { date: TODAY, time: "10:00" };

function fakeBot() {
  const sent: { to: number; text: string; buttons: string[] }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string, extra?: { reply_markup?: unknown }) => {
        // Кнопки — часть письма, а не оформление: в напоминании про сбор одна из
        // них его закрывает, и тест обязан их видеть.
        const markup = extra?.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined;
        sent.push({ to, text, buttons: (markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent };
}

function person(db: Db, name: string, tg: number | null, birthDate: string | null, isAdmin = false): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  if (isAdmin) setEmployeeAdmin(db, employee.id, true);
  return employee.id;
}

/**
 * Гасит автоотправку — то же, что делает админ кнопкой «не рассылать сам».
 *
 * Нужно тестам про ВТОРОЙ цикл: раунд вооружается при создании, и тик,
 * запущенный в день автоотправки, подмешал бы в `sent` ещё и письма команде —
 * счётчик перестал бы говорить про напоминание. Колонкой напрямую, потому что
 * полем патча `autoSendOn` становится только в задаче 7.
 */
function disarmAutoSend(db: Db, roundId: number): void {
  db.update(collections).set({ autoSendOn: null }).where(eq(collections.id, roundId)).run();
}

describe("runBirthdayNoticeTick", () => {
  it("до часа рассылки молчит целиком: нудж админам не должен приходить в 00:03", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Марк", 1, "08-08");
    person(db, "Игорь", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, { date: TODAY, time: "00:03" })).toBe(0);
    expect(sent).toHaveLength(0);

    // Тот же день, но после десяти — письмо уходит. Значит молчание было про час,
    // а не про то, что писать нечего.
    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(1);
  });

  it("tells admins a week ahead, and tells them what to do next", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(2);
    expect(sent[0]!.text).toContain("через 7 дней");
    expect(sent[0]!.text).toContain("Именинник");
  });

  it("нудж за неделю зовёт прислать ссылку боту, а не идти в раздел", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Марк", 1, "08-08");
    person(db, "Игорь", 2, null, true);

    await runBirthdayNoticeTick(db, bot, { date: "2026-08-01", time: "10:00" });

    const text = sent[0]!.text;
    expect(text).toContain("пришли ссылку сюда");
    expect(text).toContain("5 августа");            // день, в который бот разошлёт
    expect(text).toContain("кроме именинника");
  });

  it("carries the mute button for the `celebrations` kind — these letters bypass `notifyAdmins`, so nothing else attaches it", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, NOW);

    const sendMessage = bot.api.sendMessage as unknown as { mock: { calls: unknown[][] } };
    const options = sendMessage.mock.calls[0]?.[2] as
      | { reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } }
      | undefined;
    const buttons = options?.reply_markup?.inline_keyboard.flat() ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.callback_data).toBe("notice:mute:celebrations");
  });

  it("never messages the team — only admins", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    person(db, "Обычный коллега", 3, null);

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent.map((m) => m.to)).toEqual([2]);
  });

  it("does not tell an admin about their own birthday", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const birthdayAdmin = person(db, "Админ-именинник", 1, "08-08", true);
    person(db, "Другой админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(birthdayAdmin).toBeGreaterThan(0);
  });

  it("nudges once, not on every tick", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, NOW);
    await runBirthdayNoticeTick(db, bot, NOW);
    await runBirthdayNoticeTick(db, bot, { date: "2026-08-02", time: "10:00" });
    expect(sent).toHaveLength(1);
  });

  it("stays quiet for a birthday further off than a week", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Нескоро", 1, "09-01");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("stays quiet once the collection has already gone out", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const id = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, id, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x" });
    markCollectionSent(db, round.id, 1, new Date());

    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("marks the nudge even when Telegram refused, so it can't become a nag loop", async () => {
    const db = makeTestDb();
    const bot = { api: { sendMessage: vi.fn(async () => { throw new Error("bot blocked by user"); }) } } as unknown as Bot;
    const id = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
    expect(ensureBirthdayRound(db, id, TODAY)!.adminNotifiedAt).not.toBeNull();
    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
  });

  it("records the nudge in the journal", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    await runBirthdayNoticeTick(db, bot, NOW);

    const logged = listRecentAudit(db, 5).find((row) => row.type === "birthday_admin_notice")!;
    expect(logged.payload).toMatchObject({ displayName: "Именинник", daysUntil: 7, delivered: 1 });
  });

  it("does nothing at all when there are no admins to tell", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("sends a shorter status nudge, not the creation instructions, when the link is already prepared (defect 3)", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const id = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    // The admin pasted the link before the week-ahead pass ever ran for this
    // round — the case the new reminder-date feature made routine.
    const round = ensureBirthdayRound(db, id, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x" });

    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Именинник");
    expect(sent[0]!.text).not.toContain("Создай сбор");
    expect(sent[0]!.text).not.toContain("Сбербанк Онлайн");
    // Still nudges exactly once — the flag semantics are unchanged.
    expect(ensureBirthdayRound(db, id, TODAY)!.adminNotifiedAt).not.toBeNull();
    expect(await runBirthdayNoticeTick(db, bot, NOW)).toBe(0);
    expect(sent).toHaveLength(1);
  });
});

describe("runBirthdayNoticeTick — scheduled collection reminders", () => {
  it("reminds admins on the day they picked, with the link they saved", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    // Prepare the round and mark the week-ahead nudge as already done, so this
    // test observes only the scheduled reminder.
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).toContain("Именинник");
    expect(sent[0]!.text).toContain("https://sber.ru/x");
  });

  it("даёт закрыть сбор прямо из напоминания", async () => {
    // Письмо и есть просьба дожать сбор — ответ на неё должен быть здесь же.
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);

    expect(sent[0]!.buttons).toContain("✅ Собрали, закрыть");
  });

  it("не копит кнопки при нескольких админах", async () => {
    // `InlineKeyboard` мутабелен: один экземпляр на цикл добавлял бы по кнопке
    // на каждого следующего адресата.
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    person(db, "Второй админ", 3, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);

    expect(sent).toHaveLength(2);
    for (const message of sent) expect(message.buttons).toHaveLength(2);
  });

  it("reminds once, not every tick", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent).toHaveLength(1);
  });

  it("stays quiet on any other day", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-04" });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent).toHaveLength(0);
  });

  it("says nothing about a round that already went out", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());
    markCollectionSent(db, round.id, 4, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent).toHaveLength(0);
  });

  it("still never messages the team", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    person(db, "Обычный коллега", 3, null);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(sent.map((m) => m.to)).toEqual([2]);
  });

  it("records an audit line of its own", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, NOW);
    expect(listRecentAudit(db, 10).some((row) => row.type === "birthday_schedule_notice")).toBe(true);
  });

  it("reminds admins about a custom collection too", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const admin = person(db, "Admin", 9, null);
    setEmployeeAdmin(db, admin, true);
    createCustomCollection(db, {
      title: "Кофемашина", employeeId: null, eventDate: null, deadline: null,
      amountPerPerson: null, totalGoal: null, collectUrl: "https://example.test/c/1",
      messageText: null, scheduledSendOn: "2026-08-10",
    });

    expect(await runBirthdayNoticeTick(db, bot, { date: "2026-08-10", time: "10:00" })).toBe(1);
    expect(sent[0]!.text).toContain("Кофемашина");
    // Second tick must stay silent — `scheduleNotifiedAt` fires once.
    expect(await runBirthdayNoticeTick(db, bot, { date: "2026-08-10", time: "10:00" })).toBe(0);
  });

  describe("healing a missed reminder day (defect 1)", () => {
    it("still fires when the reminder day has passed and nobody ever ran the tick that day", async () => {
      const db = makeTestDb();
      const { bot, sent } = fakeBot();
      const who = person(db, "Именинник", 1, "08-08");
      person(db, "Админ", 2, null, true);
      // Picked a reminder day of the 3rd; the server was effectively "down" that
      // day since nothing ever called the tick with today === "2026-08-03". The
      // celebration itself ("2026-08-08") is still ahead, so the reminder is
      // still useful when it finally does fire.
      const round = ensureBirthdayRound(db, who, TODAY)!;
      updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-03" });
      markAdminNotified(db, round.id, new Date());
      // Здесь проверяется НАПОМИНАНИЕ, а не автоотправка: 5 августа — как раз
      // день, в который бот разослал бы этот сбор сам.
      disarmAutoSend(db, round.id);

      await runBirthdayNoticeTick(db, bot, { date: "2026-08-05", time: "10:00" });
      expect(sent.map((m) => m.to)).toEqual([2]);
      expect(sent[0]!.text).toContain("Именинник");
    });

    it("does not fire once the birthday itself has already passed", async () => {
      const db = makeTestDb();
      const { bot, sent } = fakeBot();
      // A birthday in early January: create the round while it is still ahead,
      // then simulate the tick running months later, long after the party.
      const who = person(db, "Именинник", 1, "01-05");
      person(db, "Админ", 2, null, true);
      const round = ensureBirthdayRound(db, who, "2026-01-01")!;
      updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-01-03" });
      markAdminNotified(db, round.id, new Date());

      // "2026-06-01" is far enough out that the week-ahead pass sees only next
      // year's occurrence (2027-01-05), well outside its 7-day window — so any
      // message here can only have come from the scheduled-reminder pass.
      expect(await runBirthdayNoticeTick(db, bot, { date: "2026-06-01", time: "10:00" })).toBe(0);
      expect(sent).toEqual([]);
    });

    it("still fires exactly once even after healing a missed day", async () => {
      const db = makeTestDb();
      const { bot, sent } = fakeBot();
      const who = person(db, "Именинник", 1, "08-08");
      person(db, "Админ", 2, null, true);
      const round = ensureBirthdayRound(db, who, TODAY)!;
      updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-03" });
      markAdminNotified(db, round.id, new Date());
      // Здесь проверяется НАПОМИНАНИЕ, а не автоотправка: 5 августа — как раз
      // день, в который бот разослал бы этот сбор сам.
      disarmAutoSend(db, round.id);

      await runBirthdayNoticeTick(db, bot, { date: "2026-08-05", time: "10:00" });
      await runBirthdayNoticeTick(db, bot, { date: "2026-08-05", time: "10:00" });
      await runBirthdayNoticeTick(db, bot, { date: "2026-08-06", time: "10:00" });
      expect(sent).toHaveLength(1);
    });

    it("still never messages the team when healing a missed day", async () => {
      const db = makeTestDb();
      const { bot, sent } = fakeBot();
      const who = person(db, "Именинник", 1, "08-08");
      person(db, "Админ", 2, null, true);
      person(db, "Обычный коллега", 3, null);
      const round = ensureBirthdayRound(db, who, TODAY)!;
      updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-03" });
      markAdminNotified(db, round.id, new Date());
      // Здесь проверяется НАПОМИНАНИЕ, а не автоотправка: 5 августа — как раз
      // день, в который бот разослал бы этот сбор сам.
      disarmAutoSend(db, round.id);

      await runBirthdayNoticeTick(db, bot, { date: "2026-08-05", time: "10:00" });
      expect(sent.map((m) => m.to)).toEqual([2]);
    });
  });
});

describe("автоотправка сбора", () => {
  it("рассылает команде сама, кроме именинника, и отчитывается админам", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    const toTeam = sent.filter((m) => m.text.includes("Сбор на подарок"));
    expect(toTeam.map((m) => m.to).sort()).toEqual([2, 3]);
    expect(toTeam.some((m) => m.to === 1)).toBe(false);

    const report = sent.find((m) => m.text.startsWith("💰 Разослал"));
    expect(report?.to).toBe(3);
    expect(report?.text).toContain("Марк");
    expect(report?.text).toContain("2 из 2");
  });

  it("второй тик того же дня не рассылает второй раз", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });
    const after = sent.length;
    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:05" });

    // Первый тик обязан был что-то разослать: без этой строки тест зелен и на
    // реализации, где третьего цикла нет вовсе.
    expect(after).toBeGreaterThan(0);
    expect(sent).toHaveLength(after);
  });

  it("без ссылки не рассылает, а говорит админам, что подарка не будет", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    ensureBirthdayRound(db, mark, "2026-09-01");

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    expect(sent.some((m) => m.text.includes("Сбор на подарок"))).toBe(false);
    const warning = sent.find((m) => m.text.startsWith("⚠️"));
    expect(warning?.to).toBe(3);
    expect(warning?.text).toContain("Нет ссылки");
    expect(warning?.text).toContain("через 3 дня");
  });

  it("молчит, если админ уже разослал руками — это не провал, а сделанная работа", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });
    markCollectionSent(db, round.id, 2, new Date());

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    expect(sent.filter((m) => m.text.startsWith("⚠️"))).toHaveLength(0);
    expect(sent.filter((m) => m.text.includes("Сбор на подарок"))).toHaveLength(0);
    // Молчание должно быть осознанным пропуском, а не тем, что раунд никто не
    // смотрел: отметку о попытке цикл ставит до проверки на ручную рассылку,
    // иначе он разбирал бы этот раунд каждые пять минут до самого праздника.
    expect(getCollection(db, round.id)!.autoSentAt).not.toBeNull();
  });

  it("про отсутствующую ссылку предупреждает один раз, а не каждые пять минут", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    ensureBirthdayRound(db, mark, "2026-09-01");

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });
    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:05" });

    expect(sent.filter((m) => m.text.startsWith("⚠️"))).toHaveLength(1);
  });

  it("ноль доставленных — громкий провал, а не тихий успех", async () => {
    const db = makeTestDb();
    const sent: { to: number; text: string }[] = [];
    // Telegram отверг оба письма команде и отпустил к моменту отчёта — так и
    // выглядит короткий сбой, ради которого `notifyUser` вообще возвращает false.
    let refuse = 2;
    const bot = {
      api: {
        sendMessage: vi.fn(async (to: number, text: string) => {
          if (refuse-- > 0) throw new Error("Too Many Requests");
          sent.push({ to, text });
        }),
      },
    } as unknown as Bot;
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });
    // Нудж за неделю уже был — чтобы в счёт отказов попали только письма команде.
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    const warning = sent.find((m) => m.text.startsWith("⚠️"));
    expect(warning?.to).toBe(3);
    expect(warning?.text).toContain("Telegram не принял ни одного письма");
    // И раунд не засчитан: «разослано» о письме, которого никто не получил, —
    // это ровно та тишина, из-за которой подарка не будет.
    expect(getCollection(db, round.id)!.sendCount).toBe(0);
    // В журнале — `round: 0`, как у ручки `/send` в той же ситуации. Иначе лента
    // рисует «Разослан сбор — доставлено 0 из 2» ровно в ту минуту, когда бот
    // пишет админам «⚠️ не ушёл», и два чтения одного события расходятся.
    const logged = listRecentAudit(db, 20).find((e) => e.type === "collection_sent");
    expect(logged?.payload).toMatchObject({ round: 0, delivered: 0 });
  });

  it("в день, совпавший с днём напоминания, шлёт сбор, а не инструкцию его разослать", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    // Админ вправе попросить напомнить ему в тот же день, в который бот
    // разошлёт сам: «праздник минус три» он выбирает руками, как любой другой.
    updateCollection(db, round.id, {
      collectUrl: "https://example.com/sbor",
      scheduledSendOn: "2026-09-04",
    });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    expect(sent.filter((m) => m.text.includes("Сбор на подарок"))).toHaveLength(2);
    // «Пора разослать, нажми „Разослать“» после уже состоявшейся рассылки —
    // указание, которое упрётся в 409: ручная рассылка ДР при `sendCount > 0`
    // заблокирована. Поэтому автоотправка идёт раньше напоминания, а не позже.
    expect(sent.some((m) => m.text.startsWith("⏰"))).toBe(false);
  });

  it("если разослать не вышло, напоминание админам всё равно уходит", async () => {
    const db = makeTestDb();
    const sent: { to: number; text: string }[] = [];
    // Telegram отверг оба письма команде и отпустил дальше.
    let refuse = 2;
    const bot = {
      api: {
        sendMessage: vi.fn(async (to: number, text: string) => {
          if (refuse-- > 0) throw new Error("Too Many Requests");
          sent.push({ to, text });
        }),
      },
    } as unknown as Bot;
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, {
      collectUrl: "https://example.com/sbor",
      scheduledSendOn: "2026-09-04",
    });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    // Рассылки не было — `sendCount` остался нулём, и просьба разослать руками
    // снова становится осмысленной. Молчание здесь и было бы тем самым «всё под
    // контролем», из-за которого подарка не будет.
    expect(sent.some((m) => m.text.startsWith("⚠️"))).toBe(true);
    expect(sent.some((m) => m.text.startsWith("⏰"))).toBe(true);
  });

  it("не рассылает, пока по этому сбору идёт рассылка админа", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    person(db, "Игорь", 3, null, true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    // Замок уже держит ручка `/send`: тик и она живут в одном процессе, и
    // второе письмо всей команде — ровно то, от чего замок и заведён.
    expect(claimCollectionSend(round.id)).toBe(true);
    try {
      await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

      expect(sent.filter((m) => m.text.includes("Сбор на подарок"))).toHaveLength(0);
      // Отметка при этом стоит: попытка была, и на следующем тике её не повторят.
      expect(getCollection(db, round.id)!.autoSentAt).not.toBeNull();
    } finally {
      // Тот же довод, что в задаче 5: замок живёт в модуле и переживает тест.
      releaseCollectionSend(round.id);
    }
  });

  it("отпускает замок после рассылки", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    // Без `releaseCollectionSend` в `finally` дожим по этому сбору («Напомнить»,
    // тот же замок в `app.ts`) отвечал бы «Рассылка уже идёт» до перезапуска.
    expect(claimCollectionSend(round.id)).toBe(true);
    releaseCollectionSend(round.id);
  });

  it("пишет в журнал от имени системы, а не от имени админа", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Аня", 2, null);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { collectUrl: "https://example.com/sbor" });

    await runBirthdayNoticeTick(db, bot, { date: "2026-09-04", time: "10:00" });

    const row = listRecentAudit(db, 20).find((e) => e.type === "collection_sent");
    expect(row?.actorEmployeeId).toBeNull();
  });
});
