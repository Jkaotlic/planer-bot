import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { runBirthdayNoticeTick } from "./birthday-notice";
import { ensureBirthdayRound, markAdminNotified } from "./birthday-service";
import { createCustomCollection, markCollectionSent, updateCollection } from "../collections/collection-service";
import type { Db } from "../db/client";

const TODAY = "2026-08-01";

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

function person(db: Db, name: string, tg: number | null, birthDate: string | null, isAdmin = false): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  if (isAdmin) setEmployeeAdmin(db, employee.id, true);
  return employee.id;
}

describe("runBirthdayNoticeTick", () => {
  it("tells admins a week ahead, and tells them what to do next", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(2);
    expect(sent[0]!.text).toContain("через 7 дней");
    expect(sent[0]!.text).toContain("Именинник");
  });

  it("carries the mute button for the `celebrations` kind — these letters bypass `notifyAdmins`, so nothing else attaches it", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, TODAY);

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

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
  });

  it("does not tell an admin about their own birthday", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const birthdayAdmin = person(db, "Админ-именинник", 1, "08-08", true);
    person(db, "Другой админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(birthdayAdmin).toBeGreaterThan(0);
  });

  it("nudges once, not on every tick", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    await runBirthdayNoticeTick(db, bot, TODAY);
    await runBirthdayNoticeTick(db, bot, TODAY);
    await runBirthdayNoticeTick(db, bot, "2026-08-02");
    expect(sent).toHaveLength(1);
  });

  it("stays quiet for a birthday further off than a week", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Нескоро", 1, "09-01");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
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

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("marks the nudge even when Telegram refused, so it can't become a nag loop", async () => {
    const db = makeTestDb();
    const bot = { api: { sendMessage: vi.fn(async () => { throw new Error("bot blocked by user"); }) } } as unknown as Bot;
    const id = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
    expect(ensureBirthdayRound(db, id, TODAY)!.adminNotifiedAt).not.toBeNull();
    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
  });

  it("records the nudge in the journal", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    await runBirthdayNoticeTick(db, bot, TODAY);

    const logged = listRecentAudit(db, 5).find((row) => row.type === "birthday_admin_notice")!;
    expect(logged.payload).toMatchObject({ displayName: "Именинник", daysUntil: 7, delivered: 1 });
  });

  it("does nothing at all when there are no admins to tell", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    person(db, "Именинник", 1, "08-08");
    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
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

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Именинник");
    expect(sent[0]!.text).not.toContain("Создай сбор");
    expect(sent[0]!.text).not.toContain("Сбербанк Онлайн");
    // Still nudges exactly once — the flag semantics are unchanged.
    expect(ensureBirthdayRound(db, id, TODAY)!.adminNotifiedAt).not.toBeNull();
    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
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

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).toContain("Именинник");
    expect(sent[0]!.text).toContain("https://sber.ru/x");
  });

  it("reminds once, not every tick", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    const round = ensureBirthdayRound(db, who, TODAY)!;
    updateCollection(db, round.id, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, round.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    await runBirthdayNoticeTick(db, bot, TODAY);
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

    await runBirthdayNoticeTick(db, bot, TODAY);
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

    await runBirthdayNoticeTick(db, bot, TODAY);
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

    await runBirthdayNoticeTick(db, bot, TODAY);
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

    await runBirthdayNoticeTick(db, bot, TODAY);
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

    expect(await runBirthdayNoticeTick(db, bot, "2026-08-10")).toBe(1);
    expect(sent[0]!.text).toContain("Кофемашина");
    // Second tick must stay silent — `scheduleNotifiedAt` fires once.
    expect(await runBirthdayNoticeTick(db, bot, "2026-08-10")).toBe(0);
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

      await runBirthdayNoticeTick(db, bot, "2026-08-05");
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
      expect(await runBirthdayNoticeTick(db, bot, "2026-06-01")).toBe(0);
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

      await runBirthdayNoticeTick(db, bot, "2026-08-05");
      await runBirthdayNoticeTick(db, bot, "2026-08-05");
      await runBirthdayNoticeTick(db, bot, "2026-08-06");
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

      await runBirthdayNoticeTick(db, bot, "2026-08-05");
      expect(sent.map((m) => m.to)).toEqual([2]);
    });
  });
});
