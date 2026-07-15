import { describe, it, expect } from "vitest";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, createAdminEmployee } from "../repo/employees";
import { listShiftsInRange } from "../repo/shifts";
import { createVacantSlot, listInterestedEmployeeIds, getVacantSlot } from "../repo/weekend";
import { expressInterest, assignSlot } from "../weekend/weekend-service";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent, calls };
}

function callbackUpdate(tgId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "cbq-1",
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: { message_id: 5, date: 1_712_803_046, chat: { id: tgId, first_name: "T", type: "private" as const }, text: "оффер" },
      chat_instance: "x",
      data,
    },
  };
}

/** Vacant slots only exist on days off, so fixtures must land on a weekend. */
const nextSaturday = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}` });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return w;
}

describe("weekend bot callbacks", () => {
  it("weekend:interest records interest and drops the button", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 201);
    const slot = createVacantSlot(db, { date: nextSaturday(), start: "10:00", end: "18:00" });
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(201, `weekend:interest:${slot.id}`));
    expect(listInterestedEmployeeIds(db, slot.id)).toContain(anya.id);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("weekend:confirm creates a weekend_work shift and notifies admins", async () => {
    const db = makeTestDb();
    createAdminEmployee(db, { telegramUserId: 111, tgUsername: "boss", displayName: "Босс" });
    const anya = worker(db, "Аня", 201);
    const date = nextSaturday();
    const slot = createVacantSlot(db, { date, start: "10:00", end: "18:00", title: "Ярмарка" });
    expressInterest(db, slot.id, anya.id);
    const assigned = assignSlot(db, slot.id, anya.id);
    if (!assigned.ok) throw new Error("assign failed");

    const { bot, sent, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(201, `weekend:confirm:${assigned.assignment.id}`));

    expect(listShiftsInRange(db, date, date).some((s) => s.category === "weekend_work" && s.employeeId === anya.id)).toBe(true);
    expect(calls.some((c) => c.method === "editMessageText")).toBe(true);
    expect(sent.some((s) => s.chat_id === 111 && /подтвердил/i.test(s.text))).toBe(true);
  });

  it("weekend:decline takes the entry back out of the schedule; the slot stays open", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 201);
    const date = nextSaturday();
    const slot = createVacantSlot(db, { date, start: "10:00", end: "18:00" });
    expressInterest(db, slot.id, anya.id);
    const assigned = assignSlot(db, slot.id, anya.id);
    if (!assigned.ok) throw new Error("assign failed");
    // Assigning puts it straight in the schedule and leaves the slot open for others.
    expect(listShiftsInRange(db, date, date).some((s) => s.employeeId === anya.id)).toBe(true);
    expect(getVacantSlot(db, slot.id)?.status).toBe("open");

    const { bot } = testBot(db);
    await bot.handleUpdate(callbackUpdate(201, `weekend:decline:${assigned.assignment.id}`));
    expect(listShiftsInRange(db, date, date).some((s) => s.employeeId === anya.id)).toBe(false);
    expect(getVacantSlot(db, slot.id)?.status).toBe("open");
  });

  it("tells an unknown user they are not in the system", async () => {
    const db = makeTestDb();
    const slot = createVacantSlot(db, { date: nextSaturday(), start: "10:00", end: "18:00" });
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(999, `weekend:interest:${slot.id}`));
    expect(calls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toContain("не в системе");
    expect(listInterestedEmployeeIds(db, slot.id)).toHaveLength(0);
  });
});
