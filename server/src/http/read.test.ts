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
import { setSwapsLocked } from "../repo/settings";

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

  it("без from отдаёт смены от сегодняшнего дня команды и называет эту дату", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(new Date());
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);

    createShift(db, { date: today, start: "09:00", end: "18:00", employeeId: w.id });
    createShift(db, { date: yesterdayIso, start: "09:00", end: "18:00", employeeId: w.id });

    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe(today);
    expect(body.shifts.map((s: { date: string }) => s.date)).toEqual([today]);
  });

  it("не теряет многодневную запись, начавшуюся раньше окна", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    // Отпуск с 1 по 20 июля; смотрим с 7-го — он идёт прямо сейчас.
    createShift(db, { date: "2026-07-01", endDate: "2026-07-20", category: "vacation", employeeId: w.id });

    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts?from=2026-07-07", bearer(await tokenFor(app, 333)));
    const body = await res.json();
    expect(body.shifts.map((s: { date: string }) => s.date)).toEqual(["2026-07-01"]);
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
      { id: first.id, displayName: "Первая", rosterOrder: 0, excludedFromSwaps: false },
      { id: second.id, displayName: "Вторая", rosterOrder: 1, excludedFromSwaps: false },
      { id: tied.id, displayName: "Равная", rosterOrder: 1, excludedFromSwaps: false },
      { id: late.id, displayName: "Без порядка", rosterOrder: null, excludedFromSwaps: false },
      { id: laterNull.id, displayName: "Ещё без порядка", rosterOrder: null, excludedFromSwaps: false },
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

  it("GET /api/me carries the swap-permission facts the screen needs", async () => {
    const db = makeTestDb();
    const me = worker(db, "Аня Смирнова", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);

    const open = await (await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(open).toMatchObject({ swapsLocked: false, excludedFromSwaps: false });

    setSwapsLocked(db, true, me.id);
    const locked = await (await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(locked).toMatchObject({ swapsLocked: true });
  });

  it("GET /api/team/schedule marks who is out of swaps", async () => {
    const db = makeTestDb();
    const me = worker(db, "Аня Смирнова", 333);
    const other = worker(db, "Игорь Петров", 334);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 333);

    db.update(employees).set({ excludedFromSwaps: true }).where(eq(employees.id, other.id)).run();
    const res = await app.request(
      "/api/team/schedule?from=2026-08-10&to=2026-08-16",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.employees.find((e: { id: number }) => e.id === other.id)).toMatchObject({ excludedFromSwaps: true });
    expect(body.employees.find((e: { id: number }) => e.id === me.id)).toMatchObject({ excludedFromSwaps: false });
  });
});
