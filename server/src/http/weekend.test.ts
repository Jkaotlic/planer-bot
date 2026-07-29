import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId } from "../repo/employees";
import { listShiftsInRange } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
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
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};
/** Vacant slots only exist on days off, so fixtures must land on a weekend. */
const nextSaturday = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};
async function tokenFor(app: ReturnType<typeof createApp>, tgId: number): Promise<string> {
  const res = await app.request(new Request("http://x/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(tgId) }) }));
  return (await res.json()).token as string;
}
async function worker(db: Db, app: ReturnType<typeof createApp>, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}` });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return { w, token: await tokenFor(app, tgId) };
}
const authed = (t: string, body?: unknown) => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

describe("weekend-market endpoints", () => {
  it("full flow: post → interest → fair-ranked → assign → confirm creates weekend_work shift → payroll + CSV", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = await worker(db, app, "Аня", 201);
    const igor = await worker(db, app, "Игорь", 202);

    // admin posts a vacant slot (10:00–18:00 → 8h)
    const date = nextSaturday();
    const posted = await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка", location: "Точка" }));
    expect(posted.status).toBe(201);
    const slotId = (await posted.json()).slot.id as number;

    // both workers see the open slot and express interest
    const browse = await app.request("/api/weekend/slots", bearer(anya.token));
    expect((await browse.json()).slots.some((s: any) => s.slot.id === slotId && s.interested === false)).toBe(true);
    expect((await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token))).status).toBe(201);
    expect((await app.request(`/api/weekend/slots/${slotId}/interest`, authed(igor.token))).status).toBe(201);

    // interest flag now true for Аня
    const browse2 = await app.request("/api/weekend/slots", bearer(anya.token));
    expect((await browse2.json()).slots.find((s: any) => s.slot.id === slotId).interested).toBe(true);

    // admin sees the slot with a ranked interested list (fairness: confirmedThisMonth asc)
    const adminSlots = await app.request("/api/admin/weekend/slots", bearer(admin));
    const entry = (await adminSlots.json()).slots.find((s: any) => s.slot.id === slotId);
    expect(entry.interested.map((i: any) => i.confirmedThisMonth)).toEqual([0, 0]);
    expect(entry.interested).toHaveLength(2);

    // admin assigns to Аня → she is notified
    const assigned = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }));
    expect(assigned.status).toBe(201);
    const assignmentId = (await assigned.json()).assignment.id as number;
    expect(sent.some((s) => s.chat_id === 201)).toBe(true);

    // Аня sees her offer, confirms it → weekend_work shift is created + admins notified
    const offers = await app.request("/api/weekend/offers", bearer(anya.token));
    expect((await offers.json()).offers.some((o: any) => o.assignment.id === assignmentId && o.assignment.status === "offered")).toBe(true);
    const confirmed = await app.request(`/api/weekend/offers/${assignmentId}/confirm`, authed(anya.token));
    expect(confirmed.status).toBe(200);
    const shifts = listShiftsInRange(db, date, date);
    expect(shifts.some((s) => s.category === "weekend_work" && s.employeeId === anya.w.id && s.start === "10:00")).toBe(true);
    expect(sent.some((s) => /подтвердил/i.test(s.text))).toBe(true);

    // payroll JSON + CSV reflect the confirmed work
    const payroll = await app.request(`/api/admin/weekend/payroll?from=${daysFromNow(0)}&to=${daysFromNow(30)}`, bearer(admin));
    const rows = (await payroll.json()).rows;
    expect(rows).toEqual([{ employeeId: anya.w.id, employeeName: "Аня", date, hours: 8 }]);

    const csv = await app.request(`/api/admin/weekend/payroll.csv?from=${daysFromNow(0)}&to=${daysFromNow(30)}`, bearer(admin));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("Работник,Дата,Часы");
    expect(text).toContain("Аня");
    expect(text).toContain(",8");
  });

  it("assigning keeps the slot listed and schedules the entry; declining pulls it back out", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const anya = await worker(db, app, "Аня", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00" }))).json()).slot.id as number;
    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }))).json()).assignment.id as number;

    // The slot stays listed (it may need more people) and the entry is already scheduled.
    expect((await (await app.request("/api/admin/weekend/slots", bearer(admin))).json()).slots.some((s: any) => s.slot.id === slotId)).toBe(true);
    expect(listShiftsInRange(db, date, date).some((s) => s.category === "weekend_work" && s.employeeId === anya.w.id)).toBe(true);

    // Turning it down removes the entry; the slot is still on offer.
    expect((await app.request(`/api/weekend/offers/${assignmentId}/decline`, authed(anya.token))).status).toBe(200);
    expect(listShiftsInRange(db, date, date).some((s) => s.employeeId === anya.w.id)).toBe(false);
    expect((await (await app.request("/api/admin/weekend/slots", bearer(admin))).json()).slots.some((s: any) => s.slot.id === slotId)).toBe(true);
  });

  it("journals weekend_slot_created and weekend_assigned with the admin as actor", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminEmployeeId = getByTelegramId(db, 111)!.id;
    const anya = await worker(db, app, "Аня", 201);

    const date = nextSaturday();
    const posted = await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }));
    const slotId = (await posted.json()).slot.id as number;

    const created = listRecentAudit(db, 5).find((a) => a.type === "weekend_slot_created")!;
    expect(created.actorEmployeeId).toBe(adminEmployeeId);
    expect(created.payload).toMatchObject({ slotId });
    expect(typeof (created.payload as { slot: unknown }).slot).toBe("string"); // reads without a join

    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token));
    await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }));

    const assigned = listRecentAudit(db, 5).find((a) => a.type === "weekend_assigned")!;
    expect(assigned.actorEmployeeId).toBe(adminEmployeeId);
    expect(assigned.payload).toMatchObject({ slotId, employeeId: anya.w.id, employeeName: "Аня" });
    expect(typeof (assigned.payload as { slot: unknown }).slot).toBe("string");
  });

  it("guards admin-only endpoints against workers (403)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    expect((await app.request("/api/admin/weekend/slots", authed(anya.token, { date: nextSaturday(), start: "10:00", end: "18:00" }))).status).toBe(403);
    expect((await app.request("/api/admin/weekend/slots", bearer(anya.token))).status).toBe(403);
  });

  it("rejects interest in a missing slot (400)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = await worker(db, app, "Аня", 201);
    const res = await app.request("/api/weekend/slots/9999/interest", authed(anya.token));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_found");
  });
});
