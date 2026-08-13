import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../../repo/employees";
import { createShift, getShift, listShiftsInRange } from "../../repo/shifts";
import { listRecentAudit } from "../../repo/audit";
import { signInitData } from "../../auth/telegram";
import { teamNow } from "../../util/team-time";
import { addDaysIso } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";

/** A bot that records what it was asked to send instead of talking to Telegram. */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
  handoverFanHours: 3, handoverEscalateHours: 12,
};

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;

const authed = (t: string, body?: unknown, method = "POST") => ({
  method,
  headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** A linked worker whose Telegram id equals their row id offset, for readability. */
function worker(db: Db, tgId: number, displayName: string) {
  createEmployee(db, { displayName, inviteToken: `tok-${tgId}` });
  return linkTelegramAccount(db, `tok-${tgId}`, tgId, `u${tgId}`, displayName)!;
}

/** Team dates, never the machine's — the day boundary must not depend on the runner. */
const today = () => teamNow(config.teamTz).date;
const day = (offset: number) => addDaysIso(today(), offset);

describe("POST /api/my/entries", () => {
  it("refuses a category the worker does not own, and writes nothing", async () => {
    const db = makeTestDb();
    const me = worker(db, 501, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 501);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", title: "День",
    })));

    expect(res.status).toBe(400);
    // The refusal has to be a refusal, not a 400 shouted after the row landed.
    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("records the entry on the CALLER, whatever employeeId the body carries", async () => {
    const db = makeTestDb();
    const me = worker(db, 502, "Аня");
    const other = worker(db, 503, "Игорь");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 502);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(0), endDate: day(1), employeeId: other.id,
    })));

    expect(res.status).toBe(201);
    const rows = listShiftsInRange(db, day(0), day(0));
    expect(rows.filter((s) => s.employeeId === me.id)).toHaveLength(1);
    expect(rows.filter((s) => s.employeeId === other.id)).toHaveLength(0);
  });

  it("refuses a sick leave older than the backdating window, and writes nothing", async () => {
    const db = makeTestDb();
    const me = worker(db, 504, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 504);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(-8), endDate: day(-8),
    })));

    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, day(-8), day(-8)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("refuses an event without an end — a timed entry with no hours is a second-class row", async () => {
    const db = makeTestDb();
    worker(db, 505, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 505);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "offsite", date: day(1), start: "14:00", title: "Конференция",
    })));

    expect(res.status).toBe(400);
  });

  it("journals it as a self entry, not as an admin one", async () => {
    const db = makeTestDb();
    worker(db, 506, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 506);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "offsite", date: day(2), start: "14:00", end: "16:00", title: "Конференция", location: "Поклонка",
    })));

    const types = listRecentAudit(db, 10).map((row) => row.type);
    expect(types).toContain("self_entry_created");
    expect(types).not.toContain("entry_created");
  });

  it("tells the admins, naming the shift the sick leave just left uncovered", async () => {
    const db = makeTestDb();
    const me = worker(db, 507, "Аня");
    const boss = worker(db, 508, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    createShift(db, { employeeId: me.id, date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День" });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 507);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1), endDate: day(2),
    })));

    expect(sent.map((m) => m.to)).toEqual([508]);
    expect(sent[0]!.text).toContain("Аня");
    expect(sent[0]!.text).toContain("09:00–18:00");
    // The second day holds nothing, so it must not add a line about nothing.
    expect(sent[0]!.text.split("\n")).toHaveLength(2);
  });
});

describe("PATCH /api/my/entries/:id", () => {
  it("answers 404 for somebody else's entry and leaves it alone", async () => {
    const db = makeTestDb();
    worker(db, 511, "Аня");
    const other = worker(db, 512, "Игорь");
    const theirs = createShift(db, { employeeId: other.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 511);

    const res = await app.request(new Request(`http://x/api/my/entries/${theirs.id}`, authed(token, {
      category: "sick_leave", date: day(5), endDate: day(9),
    }, "PATCH")));

    expect(res.status).toBe(404);
    expect(getShift(db, theirs.id)!.date).toBe(day(1));
  });

  it("refuses to touch an entry that has already ended", async () => {
    const db = makeTestDb();
    const me = worker(db, 513, "Аня");
    const done = createShift(db, { employeeId: me.id, date: day(-3), endDate: day(-1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 513);

    const res = await app.request(new Request(`http://x/api/my/entries/${done.id}`, authed(token, {
      category: "sick_leave", date: day(-3), endDate: day(2),
    }, "PATCH")));

    expect(res.status).toBe(400);
    expect(getShift(db, done.id)!.endDate).toBe(day(-1));
  });

  it("extends a running sick leave — that is what «продлить» means here", async () => {
    const db = makeTestDb();
    const me = worker(db, 514, "Аня");
    const running = createShift(db, { employeeId: me.id, date: day(-2), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 514);

    const res = await app.request(new Request(`http://x/api/my/entries/${running.id}`, authed(token, {
      category: "sick_leave", date: day(-2), endDate: day(4),
    }, "PATCH")));

    expect(res.status).toBe(200);
    expect(getShift(db, running.id)!.endDate).toBe(day(4));
  });

  it("refuses to turn one's own sick leave into an event", async () => {
    const db = makeTestDb();
    const me = worker(db, 515, "Аня");
    const sick = createShift(db, { employeeId: me.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 515);

    const res = await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, {
      category: "offsite", date: day(1), start: "10:00", end: "12:00", title: "Не болею",
    }, "PATCH")));

    expect(res.status).toBe(400);
    expect(getShift(db, sick.id)!.category).toBe("sick_leave");
  });

  it("dropping «по какое» actually shortens the record", async () => {
    const db = makeTestDb();
    const me = worker(db, 516, "Аня");
    const sick = createShift(db, { employeeId: me.id, date: day(0), endDate: day(5), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 516);

    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, {
      category: "sick_leave", date: day(0), endDate: null,
    }, "PATCH")));

    expect(getShift(db, sick.id)!.endDate).toBeNull();
  });
});

describe("DELETE /api/my/entries/:id", () => {
  it("refuses to delete a shift — that is the schedule, not a self entry", async () => {
    const db = makeTestDb();
    const me = worker(db, 521, "Аня");
    const shift = createShift(db, { employeeId: me.id, date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 521);

    const res = await app.request(new Request(`http://x/api/my/entries/${shift.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(400);
    expect(getShift(db, shift.id)).toBeDefined();
  });

  it("removes the worker's own event and journals it as a self entry", async () => {
    const db = makeTestDb();
    const me = worker(db, 522, "Аня");
    const event = createShift(db, {
      employeeId: me.id, date: day(3), start: "14:00", end: "16:00", category: "offsite", title: "Конференция",
    });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 522);

    const res = await app.request(new Request(`http://x/api/my/entries/${event.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    expect(getShift(db, event.id)).toBeUndefined();
    expect(listRecentAudit(db, 10).map((r) => r.type)).toContain("self_entry_deleted");
  });

  it("answers 404 for somebody else's entry and leaves it standing", async () => {
    const db = makeTestDb();
    worker(db, 523, "Аня");
    const other = worker(db, 524, "Игорь");
    const theirs = createShift(db, { employeeId: other.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 523);

    const res = await app.request(new Request(`http://x/api/my/entries/${theirs.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(404);
    expect(getShift(db, theirs.id)).toBeDefined();
  });
});
