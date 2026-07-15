import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

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
      "Утро", "День", "Вечер", "Ночь", "Дежурство · Поклонка", "Открытие", "Дежурство · Телефон", "Дежурство · Вавилова 19",
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

  it("returns the whole team schedule in a range", async () => {
    const db = makeTestDb();
    const a = worker(db, "Аня", 333);
    const b = worker(db, "Марк", 444);
    createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", employeeId: a.id });
    createShift(db, { date: "2026-07-03", start: "11:00", end: "20:00", employeeId: b.id });
    const app = createApp({ db, config });
    const res = await app.request("/api/team/schedule?from=2026-07-01&to=2026-07-07", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    expect((await res.json()).shifts.length).toBe(2);
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

  it("defaults /api/my/shifts to today (in team tz) when 'from' is omitted", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/my/shifts", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
  });
});
