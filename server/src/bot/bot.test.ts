import { describe, it, expect, vi } from "vitest";
import { decodeJwt } from "jose";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId, archiveEmployee } from "../repo/employees";
import { createShift, getShift, updateShift } from "../repo/shifts";
import { createSwap } from "../swap/swap-service";
import { teamNow } from "../util/team-time";
import { expressInterest, assignSlot, payrollRows, interestedForSlot } from "../weekend/weekend-service";
import { createVacantSlot, getAssignment } from "../repo/weekend";
import { auditLog } from "../db/schema";
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

/** Like testBot, but the given API method throws for every call — used to prove
 *  a transient Telegram failure on a cosmetic edit doesn't swallow the essential
 *  notification that was already sent before it. */
function testBotFailingMethod(db: Db, failingMethod: string) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  const calls: { method: string; payload: unknown }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === failingMethod) throw new Error("telegram down");
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
  it("greets by the name the person gave Telegram, and names the roster row they claimed", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Петров Игорь", inviteToken: "tok-1" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(333, "/start tok-1", "igor"));

    expect(getByTelegramId(db, 333)?.id).toBe(w.id);
    // "T" is this fixture's Telegram first_name. Addressing people by the roster's
    // first word would say «Петров» — a roll-call, which is the bug addressOf fixes.
    expect(sent[0]?.text).toContain("Готово, T!");
    expect(sent[0]?.text).not.toContain("Готово, Петров!");
    // …but the row they just claimed is still named: an invite is single-use, so
    // "this isn't me" has to be catchable right here.
    expect(sent[0]?.text).toContain("Петров Игорь");
  });

  it("stores the Telegram first name on link, so later messages can use it", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Петров Игорь", inviteToken: "tok-1" });
    const { bot } = testBot(db);
    await bot.handleUpdate(startUpdate(333, "/start tok-1", "igor"));
    expect(getByTelegramId(db, 333)?.tgFirstName).toBe("T");
  });

  it("does not repeat the roster name when it is the same word as the greeting", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "T", inviteToken: "tok-2" });
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(334, "/start tok-2", "t"));
    expect(sent[0]?.text).not.toContain("В расписании ты");
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

  it("/admin hands an allowlisted admin a browser login link with a token", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(111, "/admin", "boss"));
    expect(sent[0]?.text).toContain(`${config.publicUrl}/admin/#token=`);
  });

  it("/admin link expires in 12 hours, not the old 30-day window, and says so", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    const before = Math.floor(Date.now() / 1000);
    await bot.handleUpdate(startUpdate(111, "/admin", "boss"));

    // The link text should tell him it goes stale, so he isn't left guessing
    // why it stopped working days later.
    expect(sent[0]?.text).toContain("12 час");

    const token = sent[0]!.text.split("#token=")[1]!.trim();
    const { exp, iat } = decodeJwt(token);
    expect(exp).toBeDefined();
    expect(iat).toBeDefined();
    const ttlSec = exp! - iat!;
    expect(ttlSec).toBe(12 * 3600);
    expect(ttlSec).toBeLessThan(30 * 24 * 3600); // strictly shorter than the old 30-day window
    // Sanity check against wall-clock too, with slack for test runtime.
    expect(exp!).toBeGreaterThanOrEqual(before + 12 * 3600 - 5);
  });

  it("/admin refuses a non-admin", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь", inviteToken: "w" });
    linkTelegramAccount(db, "w", 777);
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(777, "/admin"));
    expect(sent[0]?.text.toLowerCase()).toContain("администратор");
  });

  it("/start tells an archived, non-allowlisted person honestly instead of inviting them into a mini app that would 403 them", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Петров Игорь", inviteToken: "arch-1" });
    linkTelegramAccount(db, "arch-1", 888);
    archiveEmployee(db, w.id, "2026-01-01");
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(888, "/start"));
    expect(sent[0]?.text.toLowerCase()).toContain("архив");
    expect(sent[0]?.text).not.toContain("Открой мини-апп");
  });

  // The invite is a door into a system this row is no longer part of: linking used
  // to succeed and answer «Ты в системе ✅», and the mini app then 403'd them.
  it("/start with the invite of an archived worker refuses to link them", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Петров Игорь", inviteToken: "arch-invite" });
    archiveEmployee(db, w.id, "2026-01-01");
    const { bot, sent } = testBot(db);

    await bot.handleUpdate(startUpdate(890, "/start arch-invite"));

    expect(sent[0]?.text).not.toContain("Ты в системе");
    expect(getByTelegramId(db, 890)).toBeUndefined();   // nothing was linked
  });

  // Somebody comes back after leaving. The admin hands them a fresh link, and their
  // old archived row still carries the same Telegram id — the cheerful «Ты уже
  // привязан» was both untrue and a dead end.
  it("/start with a new invite tells a returning archived person what to ask for", async () => {
    const db = makeTestDb();
    const old = createEmployee(db, { displayName: "Петров Игорь", inviteToken: "old-invite" });
    linkTelegramAccount(db, "old-invite", 891);
    archiveEmployee(db, old.id, "2026-01-01");
    createEmployee(db, { displayName: "Петров Игорь", inviteToken: "new-invite" });
    const { bot, sent } = testBot(db);

    await bot.handleUpdate(startUpdate(891, "/start new-invite"));

    expect(sent[0]?.text).not.toContain("уже привязан");
    expect(sent[0]?.text.toLowerCase()).toContain("архив");
    // And nothing moved: the unique Telegram id still belongs to the old row.
    expect(getByTelegramId(db, 891)?.id).toBe(old.id);
  });

  it("/start still greets an archived person normally when their Telegram id is allowlisted — POST /api/auth restores them by design", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Босс", inviteToken: "arch-2" });
    linkTelegramAccount(db, "arch-2", 111); // 111 ∈ config.adminTelegramIds
    archiveEmployee(db, w.id, "2026-01-01");
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(111, "/start"));
    expect(sent[0]?.text.toLowerCase()).not.toContain("архив");
    expect(sent[0]?.text).toContain("Открой мини-апп");
  });

  it("/admin tells an archived, non-allowlisted former admin honestly instead of handing out a token that would 401 on every request", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "arch-3", isAdmin: true });
    linkTelegramAccount(db, "arch-3", 889);
    archiveEmployee(db, w.id, "2026-01-01");
    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(889, "/admin"));
    expect(sent[0]?.text.toLowerCase()).toContain("архив");
    expect(sent[0]?.text).not.toContain("#token=");
  });

  it("/admin restores an archived allowlisted admin (like POST /api/auth does) and hands them a working token", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Босс", inviteToken: "arch-4" });
    linkTelegramAccount(db, "arch-4", 111); // 111 ∈ config.adminTelegramIds
    archiveEmployee(db, w.id, "2026-01-01");
    expect(getByTelegramId(db, 111)?.isActive).toBe(false);

    const { bot, sent } = testBot(db);
    await bot.handleUpdate(startUpdate(111, "/admin"));

    expect(sent[0]?.text).toContain("#token=");
    const restored = getByTelegramId(db, 111);
    expect(restored?.isActive).toBe(true);
    expect(restored?.isAdmin).toBe(true);
  });

  it("keeps running when a reply fails (error boundary)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    try {
      await expect(
        pollingEntryPoint.handleUpdates([startUpdate(333, "/start tok-1")])
      ).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "bot handler error (update 1):",
        "telegram down",
      );
    } finally {
      errorLog.mockRestore();
    }
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
  const created = createSwap(db, { fromEmployeeId: anya.id, fromShiftId: sa.id, toShiftId: sb.id }, teamNow(config.teamTz));
  if (!created.ok) throw new Error("setup failed to create swap");
  return { anya, igor, sa, sb, requestId: created.request.id };
}

describe("bot swap callback buttons", () => {
  it("accept callback from the counterparty exchanges shifts, preserves the proposal text, and notifies the initiator", async () => {
    const db = makeTestDb();
    const { igor, sa, sb, requestId } = setupPendingSwap(db);
    const { bot, sent, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    expect(getShift(db, sa.id)?.employeeId).toBe(igor.id);
    expect(getShift(db, sb.id)?.employeeId).not.toBe(igor.id);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    // Only the buttons go stale — rewriting the text would wipe the shift
    // details the person needs, exactly what the reminders handler's comment
    // already warns against.
    expect(calls.some((c) => c.method === "editMessageText" || c.method === "editMessageCaption")).toBe(false);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
    expect(sent.some((s) => s.chat_id === 201)).toBe(true); // Аня (initiator) notified
  });

  it("decline callback from the counterparty declines without exchanging shifts, and preserves the proposal text", async () => {
    const db = makeTestDb();
    const { sa, sb, requestId } = setupPendingSwap(db);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:decline:${requestId}`));

    const before = getShift(db, sa.id)?.employeeId;
    const beforeB = getShift(db, sb.id)?.employeeId;
    expect(getShift(db, sa.id)?.employeeId).toBe(before);
    expect(getShift(db, sb.id)?.employeeId).toBe(beforeB);
    expect(calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageText" || c.method === "editMessageCaption")).toBe(false);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("accept journals swap_accepted with the actor and a readable payload", async () => {
    const db = makeTestDb();
    const { anya, igor, requestId } = setupPendingSwap(db);
    const { bot } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    const row = db.select().from(auditLog).all().find((r) => r.type === "swap_accepted");
    expect(row).toBeDefined();
    expect(row!.actorEmployeeId).toBe(igor.id); // Игорь tapped Принять — he's the actor
    expect(row!.payload).toMatchObject({ requestId, fromEmployeeId: anya.id, fromName: "Аня", toEmployeeId: igor.id, toName: "Игорь" });
    expect(typeof (row!.payload as { fromShift: unknown }).fromShift).toBe("string"); // reads without a join
  });

  it("decline journals swap_declined with the actor", async () => {
    const db = makeTestDb();
    const { igor, requestId } = setupPendingSwap(db);
    const { bot } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:decline:${requestId}`));

    const row = db.select().from(auditLog).all().find((r) => r.type === "swap_declined");
    expect(row).toBeDefined();
    expect(row!.actorEmployeeId).toBe(igor.id);
  });

  it("admin broadcast on accept names both people and their shifts", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Босс", inviteToken: "boss", isAdmin: true });
    linkTelegramAccount(db, "boss", 111); // 111 ∈ config.adminTelegramIds
    const { requestId } = setupPendingSwap(db);
    const { bot, sent } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    const adminMsg = sent.find((s) => s.chat_id === 111);
    expect(adminMsg).toBeDefined();
    expect(adminMsg!.text).toContain("Аня");
    expect(adminMsg!.text).toContain("Игорь");
  });

  it("notifies the sibling counterparty when their pending swap is auto-cancelled by an accept", async () => {
    const db = makeTestDb();
    const { anya, sa, requestId } = setupPendingSwap(db);
    // A third person, Марк, also has a shift, and proposes trading it for Ани's sa —
    // that proposal is pending and touches the same shift as the swap below accepts.
    const mark = createEmployee(db, { displayName: "Марк", inviteToken: "mk" });
    linkTelegramAccount(db, "mk", 203);
    const sm = createShift(db, { date: daysFromNow(4), start: "09:00", end: "18:00", employeeId: mark.id });
    const sibling = createSwap(db, { fromEmployeeId: mark.id, fromShiftId: sm.id, toShiftId: sa.id }, teamNow(config.teamTz));
    if (!sibling.ok) throw new Error("setup");
    expect(sibling.request.toEmployeeId).toBe(anya.id); // Аня holds the live buttons for this one

    const { bot, sent } = testBot(db);
    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`)); // Игорь accepts the main swap

    // Аня is notified her pending decision on Марк's offer is now moot, even
    // though she never tapped anything. She also gets the regular "your swap
    // was accepted" message on the same chat, so check among all of them.
    const anyaMessages = sent.filter((s) => s.chat_id === 201).map((s) => s.text);
    expect(anyaMessages.some((t) => t.toLowerCase().includes("отменил"))).toBe(true);
    expect(anyaMessages.some((t) => t.includes("Марк"))).toBe(true);

    // And Марк — who proposed it, has been waiting, and did nothing wrong. Without
    // this he only sees «Отменено» on his own request: the same pill he'd see if
    // he had withdrawn it himself.
    const markMessages = sent.filter((s) => s.chat_id === 203).map((s) => s.text);
    expect(markMessages.some((t) => t.toLowerCase().includes("отменил"))).toBe(true);
  });

  it("a failing cosmetic edit does not suppress the initiator's notification", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    const { requestId } = setupPendingSwap(db);
    const { bot, sent } = testBotFailingMethod(db, "editMessageReplyMarkup");
    try {
      await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));
      expect(sent.some((s) => s.chat_id === 201)).toBe(true); // Аня still notified despite the edit throwing
    } finally {
      errorLog.mockRestore();
    }
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

  it("explains an ownership conflict rather than a bare «Не получилось» when the shift moved out from under a pending swap", async () => {
    const db = makeTestDb();
    const { sa, requestId } = setupPendingSwap(db);
    // The shift already went to someone else (e.g. a different, unrelated
    // completed swap, or an admin edit) while this proposal was still pending.
    const outsider = createEmployee(db, { displayName: "Марк" });
    updateShift(db, sa.id, { employeeId: outsider.id });
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    const ack = calls.find((c) => c.method === "answerCallbackQuery");
    expect((ack?.payload as { text?: string })?.text).toBe("Смена уже досталась другому человеку");
  });

  // Both overlap reasons used to read «Пересекается с твоей сменой» to whoever
  // tapped — even when the overlap belonged to the person who proposed the swap.
  it("names whose calendar the overlap is in", async () => {
    const db = makeTestDb();
    const { anya, sa, sb, requestId } = setupPendingSwap(db);
    // Аня picks up something clashing with Игоря's shift after proposing, so the
    // conflict is hers; Игорь is the one tapping Принять.
    createShift(db, { date: sb.date, start: "10:00", end: "14:00", employeeId: anya.id });
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    const text = (calls.find((c) => c.method === "answerCallbackQuery")?.payload as { text?: string })?.text;
    expect(text).toBe("У коллеги теперь пересечение по времени");
    expect(getShift(db, sa.id)?.employeeId).toBe(anya.id); // nothing exchanged
  });

  // The tapping side gets its answer in the button toast. The initiator gets
  // nothing at all — their request silently turns «Истекло» in the archive.
  it("tells the initiator when their pending swap expires under an accept", async () => {
    const db = makeTestDb();
    const { sa, requestId } = setupPendingSwap(db);
    const outsider = createEmployee(db, { displayName: "Марк" });
    updateShift(db, sa.id, { employeeId: outsider.id });
    const { bot, sent } = testBot(db);

    await bot.handleUpdate(callbackUpdate(202, `swap:accept:${requestId}`));

    const anyaMessages = sent.filter((s) => s.chat_id === 201).map((s) => s.text);
    expect(anyaMessages.some((t) => t.toLowerCase().includes("обмен"))).toBe(true);
    expect(db.select().from(auditLog).all().some((r) => r.type === "swap_expired")).toBe(true);
  });
});

describe("archived people and the buttons still sitting in their chat", () => {
  // The HTTP layer refuses an archived person outright (middleware.ts). The bot's
  // callbacks only asked «знаю ли я этот telegram id», so every button already
  // delivered to someone's chat stayed live after they left — a second, unguarded
  // entrance to the very same services. `/start` got this right and said «Ты в
  // архиве»; the action handlers did not.
  it("refuses a weekend confirm from somebody who has been archived", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня Тестова", inviteToken: "t-a" });
    linkTelegramAccount(db, "t-a", 901);
    const slot = createVacantSlot(db, { date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка" });
    expressInterest(db, slot.id, anya.id);
    const assigned = assignSlot(db, slot.id, anya.id);
    expect(assigned.ok).toBe(true);

    archiveEmployee(db, anya.id, "2026-01-01");
    const { bot, sent, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(901, `weekend:confirm:${assigned.ok ? assigned.assignment.id : 0}`));

    const toast = calls.find((c) => c.method === "answerCallbackQuery")?.payload as { text?: string } | undefined;
    expect(toast?.text).toMatch(/архив/i);
    expect(getAssignment(db, assigned.ok ? assigned.assignment.id : 0)?.status).toBe("offered");
    expect(payrollRows(db, "2099-01-03", "2099-01-03")).toEqual([]);
    expect(sent.some((s) => /подтвердил/i.test(s.text))).toBe(false);
  });

  it("refuses «хочу» on a vacant slot from somebody who has been archived", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня Тестова", inviteToken: "t-b" });
    linkTelegramAccount(db, "t-b", 902);
    const slot = createVacantSlot(db, { date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка" });

    archiveEmployee(db, anya.id, "2026-01-01");
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(902, `weekend:interest:${slot.id}`));

    const toast = calls.find((c) => c.method === "answerCallbackQuery")?.payload as { text?: string } | undefined;
    expect(toast?.text).toMatch(/архив/i);
    expect(interestedForSlot(db, slot.id)).toEqual([]);
  });

  it("still lets an allowlisted admin act while archived — /api/auth restores them on sight", async () => {
    // Same exception `/start` already makes: an allowlisted id un-archives itself
    // at the next login, so locking them out of a button would be a dead end.
    const db = makeTestDb();
    const boss = createEmployee(db, { displayName: "Босс Тестовый", inviteToken: "t-c", isAdmin: true });
    linkTelegramAccount(db, "t-c", 111); // 111 ∈ adminTelegramIds
    archiveEmployee(db, boss.id, "2026-01-01");
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(callbackUpdate(111, "reminders:off"));

    const toast = calls.find((c) => c.method === "answerCallbackQuery")?.payload as { text?: string } | undefined;
    expect(toast?.text).not.toMatch(/архив/i);
    expect(getByTelegramId(db, 111)?.remindersEnabled).toBe(false);
  });
});
