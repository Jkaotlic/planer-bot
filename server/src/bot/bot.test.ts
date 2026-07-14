import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { createSwap } from "../swap/swap-service";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

/** A bot with botInfo set (skips getMe) and a transformer capturing outgoing sendMessage. */
function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  const calls: { method: string; payload: unknown }[] = [];
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
      message: {
        message_id: 5,
        date: 1_712_803_046,
        chat: { id: tgId, first_name: "T", type: "private" as const },
        text: "предложение обмена",
      },
      chat_instance: "x",
      data,
    },
  };
}

function startUpdate(tgId: number, text: string, username?: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: tgId, is_bot: false, first_name: "T", username },
      chat: { id: tgId, first_name: "T", type: "private" as const },
      date: 1_712_803_046,
      text,
      entities: [{ offset: 0, length: 6, type: "bot_command" as const }],
    },
  };
}

describe("bot /start", () => {
  it("links a worker via /start <token> and greets by name", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-1" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(333, "/start tok-1", "igor"));
    expect(getByTelegramId(db, 333)?.id).toBe(w.id);
    expect(sent[0]?.text).toContain("Игорь");
  });

  it("replies invalid for an unknown/used token (and does not link)", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(444, "/start nope"));
    expect(getByTelegramId(db, 444)).toBeUndefined();
    expect(sent[0]?.text.toLowerCase()).toContain("ссылк");
  });

  it("tells an already-linked user they're linked, without re-linking", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня", inviteToken: "a" });
    linkTelegramAccount(db, "a", 555);
    const other = createEmployee(db, { displayName: "Марк", inviteToken: "m" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(555, "/start m")); // 555 already linked, tries Марк's token
    expect(getByTelegramId(db, 555)?.displayName).toBe("Аня"); // unchanged
    expect(getByTelegramId(db, other.telegramUserId ?? -1)).toBeUndefined();
    expect(sent[0]?.text).toContain("Аня");
  });

  it("nudges an unknown (non-allowlisted) user with no token to ask an admin", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(666, "/start"));
    expect(sent[0]?.text.toLowerCase()).toContain("админ");
    expect(getByTelegramId(db, 666)).toBeUndefined();
  });

  it("self-registers an allowlisted admin on bare /start", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(111, "/start", "boss")); // 111 ∈ adminTelegramIds
    const me = getByTelegramId(db, 111);
    expect(me?.isAdmin).toBe(true);
    expect(sent[0]?.text.toLowerCase()).toContain("админ");
  });

  it("keeps running when a reply fails (error boundary)", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь", inviteToken: "tok-1" });
    const bot = createBot({ db, config });
    bot.botInfo = {
      id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
    } as unknown as typeof bot.botInfo;
    // every outgoing call throws (Telegram down / user blocked the bot)
    bot.api.config.use(() => { throw new Error("telegram down"); });
    // grammY's public `handleUpdate` (singular) always wraps a middleware throw
    // into a BotError and rethrows it unconditionally — it never consults
    // `bot.catch`. Only the batch method the real long-polling loop uses
    // (`handleUpdates`, private in the type defs, driven by `bot.start`) catches
    // that BotError and dispatches it to the installed error handler. Reach into
    // it here so the test proves what actually matters: polling survives a
    // per-update failure instead of stopping.
    const pollingEntryPoint = bot as unknown as { handleUpdates(updates: unknown[]): Promise<void> };
    await expect(
      pollingEntryPoint.handleUpdates([startUpdate(333, "/start tok-1")])
    ).resolves.toBeUndefined();
  });
});

// acceptSwap validates shift start against real wall-clock "now" (teamNow()), so fixture
// shift dates must always be in the future — compute them relative to today.
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};

function setupPendingSwap(db: Db) {
  const anya = createEmployee(db, { displayName: "Аня", inviteToken: "a" });
  linkTelegramAccount(db, "a", 201);
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "i" });
  linkTelegramAccount(db, "i", 202);
  const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.id });
  const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.id });
  const created = createSwap(db, { fromEmployeeId: anya.id, fromShiftId: sa.id, toShiftId: sb.id });
  if (!created.ok) throw new Error("setup failed to create swap");
  return { anya, igor, sa, sb, requestId: created.request.id };
}

describe("bot swap callback buttons", () => {
  it("accept callback from the counterparty exchanges shifts, edits the message, and notifies the initiator", async () => {
    const db = makeTestDb();
    const { igor, sa, sb, requestId } = setupPendingSwap(db);
    const { bot, sent, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    expect(getShift(db, sa.id)?.employeeId).toBe(igor.id);
    expect(getShift(db, sb.id)?.employeeId).not.toBe(igor.id);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageText" || c.method === "editMessageCaption")).toBe(true);
    expect(sent.some((s) => s.chat_id === 201)).toBe(true); // Аня (initiator) notified
  });

  it("decline callback from the counterparty declines without exchanging shifts", async () => {
    const db = makeTestDb();
    const { sa, sb, requestId } = setupPendingSwap(db);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:decline:${requestId}`));

    const before = getShift(db, sa.id)?.employeeId;
    const beforeB = getShift(db, sb.id)?.employeeId;
    expect(getShift(db, sa.id)?.employeeId).toBe(before);
    expect(getShift(db, sb.id)?.employeeId).toBe(beforeB);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageText" || c.method === "editMessageCaption")).toBe(true);
  });

  it("rejects an accept callback from a non-counterparty without exchanging shifts", async () => {
    const db = makeTestDb();
    const outsider = createEmployee(db, { displayName: "Марк", inviteToken: "m" });
    linkTelegramAccount(db, "m", 999);
    const { sa, sb, requestId } = setupPendingSwap(db);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(999, `swap:accept:${requestId}`));

    expect(getShift(db, sa.id)?.employeeId).not.toBe(outsider.id);
    expect(getShift(db, sb.id)?.employeeId).not.toBe(outsider.id);
    const ack = calls.find((c) => c.method === "answerCallbackQuery");
    expect(ack).toBeDefined();
    expect((ack?.payload as { text?: string })?.text).toBeTruthy();
    expect(calls.some((c) => c.method === "editMessageText")).toBe(false);
  });
});
