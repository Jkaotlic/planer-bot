import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
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
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });

    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id, message: "выручи" }));
    expect(created.status).toBe(201);
    const reqId = (await created.json()).request.id as number;
    expect(sent.some((s) => s.chat_id === 202)).toBe(true); // Игорь notified

    const accepted = await app.request(`/api/swaps/${reqId}/accept`, authed(igor.token));
    expect(accepted.status).toBe(200);
    expect(getShift(db, sa.id)?.employeeId).toBe(igor.w.id);
    expect(getShift(db, sb.id)?.employeeId).toBe(anya.w.id);
    expect(sent.some((s) => s.chat_id === 201)).toBe(true); // Аня notified of acceptance
  });

  it("rejects a swap the caller doesn't own (400) and lists my swaps", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });
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
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id, title: "Смена Игоря" });
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

  it("rejects a non-string message (400)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const res = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id, message: {} }));
    expect(res.status).toBe(400);
  });

  it("decline flow: counterparty declines a pending swap (200)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });
    const created = await app.request("/api/swaps", authed(anya.token, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    const declined = await app.request(`/api/swaps/${reqId}/decline`, authed(igor.token));
    expect(declined.status).toBe(200);
  });

  it("cancel flow: initiator cancels a pending swap (200)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });
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
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });

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

  it("journals swap_declined for the decliner and swap_cancelled for the initiator who withdraws", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.w.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.w.id });

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
