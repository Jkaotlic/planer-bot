import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { runBirthdayNoticeTick } from "./birthday-notice";
import { updateCampaign, ensureCampaign, markSent, markAdminNotified } from "./birthday-service";
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
    updateCampaign(db, id, TODAY, { collectUrl: "https://sber.ru/x" });
    markSent(db, ensureCampaign(db, id, TODAY)!.id, 1, new Date());

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("marks the nudge even when Telegram refused, so it can't become a nag loop", async () => {
    const db = makeTestDb();
    const bot = { api: { sendMessage: vi.fn(async () => { throw new Error("bot blocked by user"); }) } } as unknown as Bot;
    const id = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);

    expect(await runBirthdayNoticeTick(db, bot, TODAY)).toBe(0);
    expect(ensureCampaign(db, id, TODAY)!.adminNotifiedAt).not.toBeNull();
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
});

describe("runBirthdayNoticeTick — scheduled collection reminders", () => {
  it("reminds admins on the day they picked, with the link they saved", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    // Prepare the round and mark the week-ahead nudge as already done, so this
    // test observes only the scheduled reminder.
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    const campaign = ensureCampaign(db, who, TODAY)!;
    markAdminNotified(db, campaign.id, new Date());

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
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(1);
  });

  it("stays quiet on any other day", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-04" });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(0);
  });

  it("says nothing about a round that already went out", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    const campaign = ensureCampaign(db, who, TODAY)!;
    markAdminNotified(db, campaign.id, new Date());
    markSent(db, campaign.id, 4, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent).toHaveLength(0);
  });

  it("still never messages the team", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    person(db, "Обычный коллега", 3, null);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(sent.map((m) => m.to)).toEqual([2]);
  });

  it("records an audit line of its own", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const who = person(db, "Именинник", 1, "08-08");
    person(db, "Админ", 2, null, true);
    updateCampaign(db, who, TODAY, { collectUrl: "https://sber.ru/x", scheduledSendOn: TODAY });
    markAdminNotified(db, ensureCampaign(db, who, TODAY)!.id, new Date());

    await runBirthdayNoticeTick(db, bot, TODAY);
    expect(listRecentAudit(db, 10).some((row) => row.type === "birthday_schedule_notice")).toBe(true);
  });
});
