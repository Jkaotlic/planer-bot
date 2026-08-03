import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, createAdminEmployee } from "../repo/employees";
import { createShift, getShift, updateShift } from "../repo/shifts";
import { auditLog } from "../db/schema";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};
function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 1, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_p, m, payload) => { if (m === "sendMessage") sent.push(payload as { chat_id: number | string; text: string }); return { ok: true, result: {} } as any; });
  return { bot, sent };
}
const initDataFor = (id: number) => signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
// acceptSwap validates shift start against real wall-clock "now" (teamToday()), so fixture
// shift dates must always be in the future — compute them relative to today rather than
// hardcoding a literal date that would eventually lapse into the past.
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};
async function worker(db: Db, app: ReturnType<typeof createApp>, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}` });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  const token = (await (await app.request(new Request("http://x/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(tgId) }) }))).json()).token as string;
  return { w, token };
}
const authed = (t: string, body?: unknown) => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe("swap endpoints", () => {
  it("create → notify counterparty → accept exchanges + notifies", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });

    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id, message: "выручи" }));
    expect(created.status).toBe(201);
    const reqId = (await created.json()).request.id as number;
    expect(sent.some((s) => s.chat_id === 202)).toBe(true); // Игорь notified

    const accepted = await app.request(`/api/swaps/${reqId}/accept`, authed(igor.token));
    expect(accepted.status).toBe(200);
    expect(getShift(db, sa.id)?.employeeId).toBe(igor.w.id);
    expect(getShift(db, sb.id)?.employeeId).toBe(anya.w.id);

    // Аня hears which swap, not just that one happened: with several proposals
    // out at once «Твой обмен приняли» names none of them. Admins already got
    // the fully-named version of the same event.
    const toAnya = sent.filter((s) => s.chat_id === 201).map((s) => s.text).join("\n");
    expect(toAnya).toContain("Игорь");
    expect(toAnya).toContain("08:00–17:00");
    expect(toAnya).toContain("11:00–20:00");
  });

  it("accept notifies admins by name and notifies the counterparty of a sibling swap it auto-cancels", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    createAdminEmployee(db, { telegramUserId: 111, tgUsername: "boss", displayName: "Босс" }); // 111 ∈ config.adminTelegramIds

    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const mark = await worker(db, app, "Марк", 203);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const sm = createShift(db, { date: daysFromNow(2), start: "09:00", end: "18:00", employeeId: mark.w.id });

    const main = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const mainId = (await main.json()).request.id as number;
    // Марк also proposes to trade his own shift for Ани's sa — still pending,
    // and about to be invalidated by the accept below.
    const siblingRes = await app.request("/api/swaps", authed(mark.token, { fromShiftId: sm.id, toShiftId: sa.id }));
    expect(siblingRes.status).toBe(201);

    const accepted = await app.request(`/api/swaps/${mainId}/accept`, authed(igor.token));
    expect(accepted.status).toBe(200);

    const adminMsg = sent.find((s) => s.chat_id === 111);
    expect(adminMsg).toBeDefined();
    expect(adminMsg!.text).toContain("Аня");
    expect(adminMsg!.text).toContain("Игорь");

    // Аня held the live Принять/Отклонить buttons for Марк's offer — she's told
    // it's now moot instead of just finding out by tapping a stale button.
    const anyaMessages = sent.filter((s) => s.chat_id === 201).map((s) => s.text);
    expect(anyaMessages.some((t) => t.toLowerCase().includes("отменил"))).toBe(true);

    // So is Марк, who proposed that offer and has been waiting on it — he'd
    // otherwise see only «Отменено», identical to having withdrawn it himself.
    const markMessages = sent.filter((s) => s.chat_id === 203).map((s) => s.text);
    expect(markMessages.some((t) => t.toLowerCase().includes("отменил"))).toBe(true);
  });

  it("rejects a swap the caller doesn't own (400) and lists my swaps", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    // Игорь tries to swap Аня's shift (not his)
    const bad = await app.request("/api/swaps", authed(igor.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    expect(bad.status).toBe(400);
    // valid create, then GET /api/swaps for Аня
    await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const list = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${anya.token}` } });
    expect((await list.json()).swaps.length).toBe(1);
  });

  it("enriches GET /api/swaps with direction, counterpartyName, and shift summaries for both sides", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id, title: "Смена Ани" });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id, title: "Смена Игоря" });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id, message: "выручи" }));
    expect(created.status).toBe(201);

    const fromAnya = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${anya.token}` } });
    const anyaSwap = (await fromAnya.json()).swaps[0];
    expect(anyaSwap.direction).toBe("outgoing");
    expect(anyaSwap.counterpartyName).toBe("Игорь");
    expect(anyaSwap.yourShift).toEqual({ date: sa.date, start: sa.start, end: sa.end, title: "Смена Ани" });
    expect(anyaSwap.theirShift).toEqual({ date: sb.date, start: sb.start, end: sb.end, title: "Смена Игоря" });

    const fromIgor = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${igor.token}` } });
    const igorSwap = (await fromIgor.json()).swaps[0];
    expect(igorSwap.direction).toBe("incoming");
    expect(igorSwap.counterpartyName).toBe("Аня");
    expect(igorSwap.yourShift).toEqual({ date: sb.date, start: sb.start, end: sb.end, title: "Смена Игоря" });
    expect(igorSwap.theirShift).toEqual({ date: sa.date, start: sa.start, end: sa.end, title: "Смена Ани" });
  });

  it("refuses to propose a swap between two identical shifts (400, identical-shift)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    // Both work the same hand-made «08:00–17:00» shift on the same day — a swap
    // between them would leave both exactly where they started.
    const same = daysFromNow(2);
    const sa = createShift(db, { date: same, start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: same, start: "08:00", end: "17:00", employeeId: igor.w.id });

    const res = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("identical-shift");
  });

  it("refuses the mirror of a swap the colleague already proposed (400, mirror)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    // They agreed in person, so both open a request from their own side. It's one
    // trade; two rows for it made the accept contradict itself in chat.
    expect((await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }))).status).toBe(201);
    const mirrored = await app.request("/api/swaps", authed(igor.token, { fromShiftId: sb.id, toShiftId: sa.id }));
    expect(mirrored.status).toBe(400);
    expect((await mirrored.json()).error).toBe("mirror");
  });

  it("rejects a non-string message (400)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const res = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id, message: {} }));
    expect(res.status).toBe(400);
  });

  it("decline flow: counterparty declines a pending swap (200), naming the swap", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    const declined = await app.request(`/api/swaps/${reqId}/decline`, authed(igor.token));
    expect(declined.status).toBe(200);
    const toAnya = sent.filter((s) => s.chat_id === 201).map((s) => s.text).join("\n");
    expect(toAnya).toContain("Игорь");
    expect(toAnya).toContain("08:00–17:00");
  });

  it("cancel flow: initiator cancels a pending swap (200)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    const cancelled = await app.request(`/api/swaps/${reqId}/cancel`, authed(anya.token));
    expect(cancelled.status).toBe(200);
  });

  it("journals swap_proposed for the initiator and swap_accepted for the accepter, both with readable names and shifts", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });

    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;

    const rowsAfterPropose = db.select().from(auditLog).all();
    const proposed = rowsAfterPropose.find((r) => r.type === "swap_proposed")!;
    expect(proposed.actorEmployeeId).toBe(anya.w.id); // the initiator, not the counterparty
    expect(proposed.payload).toMatchObject({
      requestId: reqId,
      fromEmployeeId: anya.w.id,
      fromName: "Аня",
      toEmployeeId: igor.w.id,
      toName: "Игорь",
    });
    // A line must read without a join back to shifts — both sides carry a description, not bare ids.
    expect(typeof (proposed.payload as { fromShift: unknown }).fromShift).toBe("string");
    expect(typeof (proposed.payload as { toShift: unknown }).toShift).toBe("string");

    const accepted = await app.request(`/api/swaps/${reqId}/accept`, authed(igor.token));
    expect(accepted.status).toBe(200);
    const acceptedRow = db.select().from(auditLog).all().find((r) => r.type === "swap_accepted")!;
    // Игорь accepted — he's the actor, even though Аня proposed the swap.
    expect(acceptedRow.actorEmployeeId).toBe(igor.w.id);
    expect(acceptedRow.payload).toMatchObject({ requestId: reqId, fromEmployeeId: anya.w.id, toEmployeeId: igor.w.id });
  });

  it("deleting a shift expires the swap hanging on it, tells both sides, and journals it", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    createAdminEmployee(db, { telegramUserId: 111, tgUsername: "boss", displayName: "Босс" });
    const adminToken = (await (await app.request(new Request("http://x/api/auth", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(111) }),
    }))).json()).token as string;

    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    sent.length = 0;

    // The admin deletes Игорь's shift out from under the pending request.
    const del = await app.request(`/api/admin/entries/${sb.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    expect(del.status).toBe(200);

    // The request survives as history, in the state the spec reserves for this.
    const list = await app.request("/api/swaps", { headers: { Authorization: `Bearer ${anya.token}` } });
    const rows = (await list.json()).swaps as { id: number; status: string }[];
    expect(rows.find((r) => r.id === reqId)?.status).toBe("expired");

    // Both sides hear about it — including Аня, who never touched anything.
    for (const chat of [201, 202]) {
      const text = sent.filter((s) => s.chat_id === chat).map((s) => s.text).join("\n");
      expect(text.toLowerCase()).toContain("обмен");
    }

    const expired = db.select().from(auditLog).all().find((r) => r.type === "swap_expired");
    expect(expired).toBeDefined();
    expect(expired!.payload).toMatchObject({ requestId: reqId, fromName: "Аня", toName: "Игорь" });
  });

  // Without its own event the journal shows the sibling as `swap_cancelled` —
  // nothing, in other words, which reads exactly like the initiator withdrawing it.
  it("journals an auto-cancelled sibling as its own event, with the accepter as actor", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const mark = await worker(db, app, "Марк", 203);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const sm = createShift(db, { date: daysFromNow(2), start: "09:00", end: "18:00", employeeId: mark.w.id });

    const main = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const mainId = (await main.json()).request.id as number;
    const sibling = await app.request("/api/swaps", authed(mark.token, { fromShiftId: sm.id, toShiftId: sa.id }));
    const siblingId = (await sibling.json()).request.id as number;

    expect((await app.request(`/api/swaps/${mainId}/accept`, authed(igor.token))).status).toBe(200);

    const rows = db.select().from(auditLog).all();
    const auto = rows.find((r) => r.type === "swap_auto_cancelled");
    expect(auto).toBeDefined();
    expect(auto!.actorEmployeeId).toBe(igor.w.id); // whose accept knocked it out
    expect(auto!.payload).toMatchObject({ requestId: siblingId, fromName: "Марк", toName: "Аня" });
    // And it is not filed as a withdrawal — nobody withdrew anything.
    expect(rows.some((r) => r.type === "swap_cancelled")).toBe(false);
  });

  it("tells the initiator when their pending swap expires under an accept, and journals it", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const mark = await worker(db, app, "Марк", 203);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;

    // The shift moved out from under the proposal — an admin edit, or another swap.
    updateShift(db, sa.id, { employeeId: mark.w.id });
    sent.length = 0;

    const accepted = await app.request(`/api/swaps/${reqId}/accept`, authed(igor.token));
    expect(accepted.status).toBe(400);

    // Игорь saw the reason in the response. Аня, who proposed it and has been
    // waiting, would otherwise just find «Истекло» in her archive one day.
    const anyaMessages = sent.filter((s) => s.chat_id === 201).map((s) => s.text);
    expect(anyaMessages.some((t) => t.toLowerCase().includes("обмен"))).toBe(true);
    expect(db.select().from(auditLog).all().some((r) => r.type === "swap_expired")).toBe(true);
  });

  it("journals swap_declined for the decliner and swap_cancelled for the initiator who withdraws", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.w.id });

    const first = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const firstId = (await first.json()).request.id as number;
    await app.request(`/api/swaps/${firstId}/decline`, authed(igor.token));
    const declined = db.select().from(auditLog).all().find((r) => r.type === "swap_declined")!;
    expect(declined.actorEmployeeId).toBe(igor.w.id); // the one who declined

    const second = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const secondId = (await second.json()).request.id as number;
    await app.request(`/api/swaps/${secondId}/cancel`, authed(anya.token));
    const cancelled = db.select().from(auditLog).all().find((r) => r.type === "swap_cancelled")!;
    expect(cancelled.actorEmployeeId).toBe(anya.w.id); // the initiator who withdrew it
  });
});
