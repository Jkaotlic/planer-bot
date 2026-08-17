import { describe, it, expect } from "vitest";
import { recordApi, stubBotInfo } from "../bot/testbot";
import { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getByTelegramId, setEmployeeRestrictions } from "../repo/employees";
import { listShiftsInRange } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();
function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 1, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
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
    const confirmMsg = sent.find((s) => /подтвердил/i.test(s.text));
    expect(confirmMsg).toBeDefined();
    expect(confirmMsg!.text).toContain("Аня"); // named, not a bare "Работник подтвердил"
    expect(confirmMsg!.text).toContain("Ярмарка"); // and which slot

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

  it("unassign notifies the worker, naming the slot they were taken off", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = await worker(db, app, "Аня", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;
    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }))).json()).assignment.id as number;

    const unassigned = await app.request(`/api/admin/weekend/assignments/${assignmentId}/unassign`, authed(admin));
    expect(unassigned.status).toBe(200);
    expect(listShiftsInRange(db, date, date).some((s) => s.employeeId === anya.w.id)).toBe(false);

    // Previously silent: the worker only found out by noticing the entry had
    // vanished. Now they're told, with which slot and a next step.
    const msg = sent.find((s) => s.chat_id === 201 && /сняли/i.test(s.text));
    expect(msg).toBeDefined();
    expect(msg!.text).toContain("Ярмарка");
  });

  it("снятие назначения попадает в журнал с именем и слотом", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const mark = await worker(db, app, "Марк Волков", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;
    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(mark.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: mark.w.id }))).json()).assignment.id as number;

    expect((await app.request(`/api/admin/weekend/assignments/${assignmentId}/unassign`, authed(admin))).status).toBe(200);

    const event = listRecentAudit(db, 10).find((row) => row.type === "weekend_unassigned");
    const payload = event?.payload as { employeeName: string; slot: string };
    expect(payload.employeeName).toBe("Марк Волков");
    expect(payload.slot).toContain("Ярмарка");
  });

  // declineOffer отказывает после confirm (статус уже не "offered", см.
  // weekend-service.ts) — единый сценарий «отклик → назначение → подтверждение →
  // отказ» из брифа падает на последнем шаге не из-за бага, а потому что
  // подтверждённое назначение отклонить уже нельзя. Поэтому здесь два теста:
  // один доводит до подтверждения, второй отказывается сразу после назначения,
  // не подтверждая. Вместе они покрывают все три типа события работника.
  it("отклик и подтверждение выходной смены видны в журнале, а не только её назначение", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const mark = await worker(db, app, "Марк Волков", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;

    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(mark.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: mark.w.id }))).json()).assignment.id as number;
    await app.request(`/api/weekend/offers/${assignmentId}/confirm`, authed(mark.token));

    const journal = listRecentAudit(db, 20);
    for (const type of ["weekend_interest", "weekend_offer_confirmed"]) {
      const event = journal.find((row) => row.type === type);
      expect(event, type).toBeDefined();
      expect((event!.payload as { employeeName: string }).employeeName).toBe("Марк Волков");
      expect((event!.payload as { slot: string }).slot).toContain("Ярмарка");
      expect(event!.actorEmployeeId).toBe(mark.w.id);
    }
  });

  it("отказ от выходной смены без подтверждения тоже виден в журнале", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const mark = await worker(db, app, "Марк Волков", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }))).json()).slot.id as number;

    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(mark.token));
    const assignmentId = (await (await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: mark.w.id }))).json()).assignment.id as number;
    await app.request(`/api/weekend/offers/${assignmentId}/decline`, authed(mark.token));

    const event = listRecentAudit(db, 10).find((row) => row.type === "weekend_offer_declined");
    expect(event).toBeDefined();
    expect((event!.payload as { employeeName: string }).employeeName).toBe("Марк Волков");
    expect((event!.payload as { slot: string }).slot).toContain("Ярмарка");
    expect(event!.actorEmployeeId).toBe(mark.w.id);
  });

  it("a repeat assign of an already-assigned worker sends no second Telegram nudge", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = await worker(db, app, "Аня", 201);

    const date = nextSaturday();
    const slotId = (await (await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00" }))).json()).slot.id as number;
    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token));

    // Posting the slot already broadcasts a "хочешь?" nudge to every active worker
    // (notifyVacantSlot) — count only the per-assignee "подтвердишь?" offer below.
    const offerPings = () => sent.filter((s) => s.chat_id === 201 && /подтвердишь/i.test(s.text));

    const first = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }));
    expect(first.status).toBe(201);
    expect(offerPings()).toHaveLength(1);

    // Admin double-taps "Назначить" on the same, already-assigned person — a true
    // no-op per assignSlot, so it must not ping Аня a second time for nothing new.
    const second = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }));
    expect(second.status).toBe(201);
    expect(offerPings()).toHaveLength(1);
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

describe("the admin cannot put an archived worker on a weekend slot", () => {
  it("refuses the assign (400, not_active) and stops showing them as a candidate", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const anya = await worker(db, app, "Аня", 201);

    const date = nextSaturday();
    const posted = await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }));
    const slotId = (await posted.json()).slot.id as number;
    expect((await app.request(`/api/weekend/slots/${slotId}/interest`, authed(anya.token))).status).toBe(201);

    await app.request(`/api/admin/employees/${anya.w.id}/archive`, authed(admin, {}));

    // She volunteered before leaving; the admin's list must not still offer her.
    const adminSlots = await app.request("/api/admin/weekend/slots", bearer(admin));
    const entry = (await adminSlots.json()).slots.find((s: any) => s.slot.id === slotId);
    expect(entry.interested).toHaveLength(0);

    // And a direct call — the admin console keeps a stale list, or somebody scripts it.
    const assigned = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: anya.w.id }));
    expect(assigned.status).toBe(400);
    expect((await assigned.json()).error).toBe("not_active");
    expect(listShiftsInRange(db, date, date)).toHaveLength(0);
  });
});

describe("posting a vacant slot says how far the broadcast actually got", () => {
  // Only people who have linked Telegram can be reached. With a third of the team
  // linked, «опубликовано» reads as «спросил команду» when it asked nine of them.
  it("returns delivered and intended alongside the slot", async () => {
    const db = makeTestDb();
    const { bot } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    await worker(db, app, "Первый Работник", 201);   // linked
    await worker(db, app, "Второй Работник", 202);   // linked
    createEmployee(db, { displayName: "Третий Работник" }); // никогда не заходил в бота

    const posted = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date: nextSaturday(), start: "10:00", end: "18:00", title: "Ярмарка" }),
    );
    expect(posted.status).toBe(201);
    const body = await posted.json();
    // The admin (111) is on the roster too and did link, so they are counted.
    expect(body.intended).toBe(4);
    expect(body.delivered).toBe(3);
  });
});

// Without a bot configured, the route computes `intended` itself instead of going
// through notifyVacantSlot — a separate spot that has to apply the same exclusion
// filter, or the count disagrees with itself depending on whether a bot exists.
describe("posting a vacant slot with no bot configured still filters excluded people out of intended", () => {
  it("intended matches the bot branch's filter — excluded people are not counted, and reappear once cleared", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config }); // no bot: exercises the app.ts fallback branch directly
    const admin = await tokenFor(app, 111); // auto-registers as an active roster member too
    await worker(db, app, "Аня Смирнова", 201);
    const igor = await worker(db, app, "Игорь Петров", 202);
    setEmployeeRestrictions(db, igor.w.id, { excludedFromAssignment: true });

    const date = nextSaturday();
    const excluded = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }),
    );
    expect(excluded.status).toBe(201);
    const excludedBody = await excluded.json();
    expect(excludedBody.delivered).toBe(0); // no bot — nothing can actually be sent
    expect(excludedBody.intended).toBe(2); // admin + Аня, minus excluded Игорь

    // Same fixture, flag cleared — a different slot (same date, different time) to
    // dodge the duplicate-post guard, which the exact-match slot above would trigger.
    setEmployeeRestrictions(db, igor.w.id, { excludedFromAssignment: false });
    const cleared = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date, start: "11:00", end: "19:00", title: "Ярмарка" }),
    );
    expect(cleared.status).toBe(201);
    expect((await cleared.json()).intended).toBe(3);
  });
});

describe("the admin cannot assign an excluded worker", () => {
  it("refuses the assign (400) with a Russian phrase, not the raw reason code", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const igor = await worker(db, app, "Игорь Петров", 201);

    const date = nextSaturday();
    const posted = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }),
    );
    const slotId = (await posted.json()).slot.id as number;
    expect((await app.request(`/api/weekend/slots/${slotId}/interest`, authed(igor.token))).status).toBe(201);

    setEmployeeRestrictions(db, igor.w.id, { excludedFromAssignment: true });

    const assigned = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: igor.w.id }));
    expect(assigned.status).toBe(400);
    expect((await assigned.json()).error).toBe("Этот человек выведен из назначений");
  });
});

describe("двойной клик по «Опубликовать» не должен плодить одинаковые слоты", () => {
  it("второй пост той же смены возвращает существующий слот, а не создаёт второй", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    await worker(db, app, "Работник", 201);

    const date = nextSaturday();
    const input = { date, start: "10:00", end: "18:00", title: "Ярмарка", location: "Точка" };

    const first = await app.request("/api/admin/weekend/slots", authed(admin, input));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await app.request("/api/admin/weekend/slots", authed(admin, input));
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody.slot.id).toBe(firstBody.slot.id);
    const listed = await (await app.request("/api/admin/weekend/slots", bearer(admin))).json();
    expect(listed.slots.filter((s: any) => s.slot.date === date)).toHaveLength(1);
    // Broadcast ушёл ровно один раз — второй "пост" никого не будит заново.
    expect(sent).toHaveLength(2); // admin + Работник, один раз
    expect(secondBody.delivered).toBe(0);
    expect(secondBody.intended).toBe(0);
  });

  it("другой день или другое время — это законно новый слот, не дубль", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const date = nextSaturday();

    const first = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date, start: "10:00", end: "18:00", title: "Ярмарка" }),
    );
    const second = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date, start: "12:00", end: "20:00", title: "Ярмарка" }),
    );
    expect(second.status).toBe(201);
    expect((await second.json()).slot.id).not.toBe((await first.json()).slot.id);
  });
});

describe("a vacant slot in the past", () => {
  const lastSaturday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7 || 7));
    return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
  };

  // A mistyped year, and the team gets a «нужен человек» broadcast with a button
  // that would have written a weekend_work entry into the past.
  it("cannot be opened on a weekday either, holiday or not (400)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    // The next Monday — and the same answer would come for a public holiday, since
    // the system has no holiday calendar. Both write paths into a weekend_work
    // entry say this; nothing used to check that they still did.
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((1 - monday.getUTCDay() + 7) % 7 || 7));
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(monday);

    const res = await app.request("/api/admin/weekend/slots", authed(admin, { date, start: "10:00", end: "18:00" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("субботой или воскресеньем");
  });

  it("cannot be opened (400)", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);

    const res = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date: lastSaturday(), start: "10:00", end: "18:00", title: "Ярмарка" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("прошла");
    expect(sent).toHaveLength(0); // and nobody was asked
  });
});

// The one write path into `shifts` that never went through `createEntrySchema`: the
// slot's own times are copied into the schedule entry when somebody is assigned.
// Nothing checked they were times at all — `typeof === "string"` was the whole guard.
describe("вакантный слот проверяет время, а не просто «строка»", () => {
  it("отказывает нечасам, и никого об этом не спрашивает", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);

    const res = await app.request(
      "/api/admin/weekend/slots",
      authed(admin, { date: nextSaturday(), start: "абв", end: "по обстоятельствам" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ЧЧ:ММ/);
    expect(sent).toHaveLength(0); // the team is not asked about a slot that can't exist
  });

  it("отказывает и одиночной цифре часа — сортировка расписания идёт по строке", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const res = await app.request("/api/admin/weekend/slots", authed(admin, { date: nextSaturday(), start: "9:00", end: "18:00" }));
    expect(res.status).toBe(400);
  });

  it("отказывает дате, которая не дата, тем же 400 — а не мимо проверки выходного", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const res = await app.request("/api/admin/weekend/slots", authed(admin, { date: "31.02.2026", start: "10:00", end: "18:00" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ГГГГ-ММ-ДД/);
  });

  // What the missing check actually cost: the slot went out to the whole team, and
  // the failure surfaced two steps later as an opaque 500 on «Назначить» —
  // `hours` is computed from those times, and NaN violates NOT NULL.
  it("нормальные часы по-прежнему проходят и назначаются", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const { w, token } = await worker(db, app, "Волонтёр Вова", 999);

    const posted = await app.request("/api/admin/weekend/slots", authed(admin, { date: nextSaturday(), start: "10:00", end: "18:00" }));
    expect(posted.status).toBe(201);
    const slotId = (await posted.json()).slot.id as number;

    await app.request(`/api/weekend/slots/${slotId}/interest`, authed(token));
    const assigned = await app.request(`/api/admin/weekend/slots/${slotId}/assign`, authed(admin, { employeeId: w.id }));
    expect(assigned.status).toBe(201);
  });
});
