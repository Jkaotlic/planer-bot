import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { employees } from "../db/schema";
import { eq } from "drizzle-orm";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-secret-16chars-min", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}

describe("read endpoints", () => {
  it("returns seeded templates to any authed user", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/templates", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    expect((await res.json()).templates.map((t: { name: string }) => t.name)).toEqual([
      "Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка", "Дежурство с 07:00", "Дежурство · Телефон", "Дежурство · Вавилова 19",
      "Дежурство · Резерв",
    ]);
  });

  it("returns the caller's own upcoming shifts", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    createShift(db, { date: "2026-07-06", start: "11:00", end: "20:00", employeeId: w.id });
    createShift(db, { date: "2026-06-01", start: "08:00", end: "17:00", employeeId: w.id }); // past
    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts?from=2026-07-01", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    expect((await res.json()).shifts.map((s: { date: string }) => s.date)).toEqual(["2026-07-06"]);
  });

  it("returns the full active roster in roster order and every overlapping shift", async () => {
    const db = makeTestDb();
    const late = worker(db, "Без порядка", 333);
    const second = worker(db, "Вторая", 444);
    const tied = worker(db, "Равная", 445);
    const first = worker(db, "Первая", 555);
    const laterNull = worker(db, "Ещё без порядка", 556);
    const archived = worker(db, "Архив", 666);
    db.update(employees).set({ rosterOrder: 1 }).where(eq(employees.id, second.id)).run();
    db.update(employees).set({ rosterOrder: 1 }).where(eq(employees.id, tied.id)).run();
    db.update(employees).set({ rosterOrder: 0 }).where(eq(employees.id, first.id)).run();
    db.update(employees).set({ isActive: false }).where(eq(employees.id, archived.id)).run();

    createShift(db, {
      date: "2026-06-28",
      endDate: "2026-07-03",
      category: "vacation",
      employeeId: first.id,
    });
    createShift(db, {
      date: "2026-07-02",
      start: "08:00",
      end: "17:00",
      employeeId: null,
    });

    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-07", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.employees).toEqual([
      { id: first.id, displayName: "Первая", rosterOrder: 0 },
      { id: second.id, displayName: "Вторая", rosterOrder: 1 },
      { id: tied.id, displayName: "Равная", rosterOrder: 1 },
      { id: late.id, displayName: "Без порядка", rosterOrder: null },
      { id: laterNull.id, displayName: "Ещё без порядка", rosterOrder: null },
    ]);
    expect(body.shifts).toHaveLength(2);
    expect(body.shifts.some((shift: { employeeId: number | null }) => shift.employeeId === null)).toBe(true);
    expect(body.shifts.some((shift: { date: string }) => shift.date === "2026-06-28")).toBe(true);
  });

  it.each([
    ["/api/team/schedule?from=nope&to=2026-07-07", 400],
    ["/api/team/schedule?from=2026-07-08&to=2026-07-07", 400],
    ["/api/team/schedule?from=2026-07-01&to=2026-08-01", 400],
  ])("rejects invalid team range %s", async (path, status) => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    expect((await app.request(path, bearer(await tokenFor(app, 333)))).status).toBe(status);
  });

  it("accepts an inclusive 31-day team range", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/team/schedule?from=2026-07-01&to=2026-07-31",
      bearer(await tokenFor(app, 333)),
    );
    expect(res.status).toBe(200);
  });

  it("gates /api/admin/employees to admins", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333); // non-admin
    const app = createApp({ db, config });
    const forbidden = await app.request("/api/admin/employees", bearer(await tokenFor(app, 333)));
    expect(forbidden.status).toBe(403);
    const ok = await app.request("/api/admin/employees", bearer(await tokenFor(app, 111))); // allowlisted admin
    expect(ok.status).toBe(200);
    expect((await ok.json()).employees.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a protected route without a token (401)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/templates");
    expect(res.status).toBe(401);
  });

  it("rejects /api/team/schedule missing the required 'to' param (400)", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(400);
  });

  it("shapes /api/team/schedule shifts: strips the admin-only 'note' but keeps every field the frontends read", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    createShift(db, {
      date: "2026-07-06",
      start: "08:00",
      end: "17:00",
      endDate: null,
      category: "shift",
      title: "Утро",
      location: "Поклонка",
      templateId: null,
      employeeId: w.id,
      unrecognisedCode: null,
      note: "Личная заметка админа — не для всей команды",
    });
    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-07", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    const shift = (await res.json()).shifts[0];

    // Every field the miniapp/admin `Shift` types actually declare and read.
    expect(shift).toEqual({
      id: shift.id,
      date: "2026-07-06",
      start: "08:00",
      end: "17:00",
      endDate: null,
      category: "shift",
      title: "Утро",
      location: "Поклонка",
      unrecognisedCode: null,
      templateId: null,
      employeeId: w.id,
    });
    expect(shift.note).toBeUndefined();
  });

  // Archiving only unassigns shifts from the archive date onward — everything
  // before it keeps the archived id, by design (that history is real). But the
  // grid draws its rows from the active people this same response lists, so those
  // entries went out to every worker in the team and rendered nowhere.
  it("leaves an archived worker's past shifts out of /api/team/schedule", async () => {
    const db = makeTestDb();
    const staying = worker(db, "Первый Работник", 333);
    const leaving = worker(db, "Второй Работник", 334);
    createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", employeeId: staying.id });
    createShift(db, { date: "2026-07-03", start: "08:00", end: "17:00", employeeId: leaving.id });
    const app = createApp({ db, config });
    // Archived as of a later date, so the July entry is untouched history.
    db.update(employees).set({ isActive: false }).where(eq(employees.id, leaving.id)).run();

    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-07", bearer(await tokenFor(app, 333)));
    const body = await res.json();
    expect(body.employees.map((e: { id: number }) => e.id)).toEqual([staying.id]);
    expect(body.shifts.map((s: { employeeId: number | null }) => s.employeeId)).toEqual([staying.id]);
  });

  it("still marks an unreadable roster-import cell as «?» on /api/team/schedule", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    createShift(db, {
      date: "2026-07-06",
      category: "shift",
      unrecognisedCode: "Ко",
    });
    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-07", bearer(await tokenFor(app, 333)));
    const shift = (await res.json()).shifts[0];
    expect(shift.unrecognisedCode).toBe("Ко");
  });

  it("defaults /api/my/shifts to today (in team tz) when 'from' is omitted", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
  });
});
