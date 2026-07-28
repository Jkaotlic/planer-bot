import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { getTemplateRoles } from "../repo/template-roles";
import { createShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const send = (token: string, body: unknown, method = "PUT") => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const presetId = (db: Db, name: string) => listActiveTemplates(db).find((t) => t.name === name)!.id;

describe("GET /api/admin/templates/roles", () => {
  it("lists every preset, unconfigured ones as «everyone»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/templates/roles", { headers: { Authorization: `Bearer ${await tokenFor(app, 111)}` } });

    expect(res.status).toBe(200);
    const { templates } = await res.json();
    expect(templates).toHaveLength(listActiveTemplates(db).length);
    expect(templates.every((t: { pool: number[] }) => t.pool.length === 0)).toBe(true);
    // The screen needs the name and colour to render the card, not just the id.
    expect(templates[0]).toMatchObject({ name: expect.any(String), accent: expect.any(String) });
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Работник", inviteToken: "inv-1" });
    linkTelegramAccount(db, "inv-1", 222);
    const res = await app.request("/api/admin/templates/roles", { headers: { Authorization: `Bearer ${await tokenFor(app, 222)}` } });
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/admin/templates/:id/roles", () => {
  it("saves the pool and preferences, and records the change", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const pokl = presetId(db, "Дежурство · Поклонка");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;

    const res = await app.request(`/api/admin/templates/${pokl}/roles`, send(token, { pool: [a, b], preference: { [b]: 2 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templateId: pokl, pool: [a, b], preference: { [String(b)]: 2 } });
    expect(getTemplateRoles(db, pokl)).toEqual({ pool: [a, b], preference: { [b]: 2 } });

    const logged = listRecentAudit(db, 5).find((row) => row.type === "template_roles_changed")!;
    expect(logged.payload).toMatchObject({ templateId: pokl, poolSize: 2, preferred: 1 });
  });

  it("rejects a bad body and an unknown preset", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const night = presetId(db, "Ночь");

    expect((await app.request(`/api/admin/templates/${night}/roles`, send(token, {}))).status).toBe(400);
    expect((await app.request(`/api/admin/templates/${night}/roles`, send(token, { pool: ["Аня"] }))).status).toBe(400);
    expect((await app.request(`/api/admin/templates/${night}/roles`, send(token, { pool: [], preference: [1, 2] }))).status).toBe(400);
    expect((await app.request("/api/admin/templates/9999/roles", send(token, { pool: [] }))).status).toBe(404);
  });

  it("refuses an archived worker with a readable message", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const night = presetId(db, "Ночь");
    const gone = createEmployee(db, { displayName: "Уволенный" }).id;
    archiveEmployee(db, gone, "2026-06-01");

    const res = await app.request(`/api/admin/templates/${night}/roles`, send(token, { pool: [gone] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/неизвестные сотрудники/);
  });
});

describe("the pool actually changes who «Распределить честно» picks", () => {
  it("keeps a duty inside its pool, and leaves it empty when the pool is away", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const night = presetId(db, "Ночь");
    // Created before the first auth call, so these hold the low ids and the
    // "whoever is freest, lowest id wins" tiebreak lands on a real worker rather
    // than on the admin the allowlist auto-registers.
    const inPool = createEmployee(db, { displayName: "Дежурный" }).id;
    const outside = createEmployee(db, { displayName: "Посторонний" }).id;
    const token = await tokenFor(app, 111);

    // An open night slot with nobody on it.
    createShift(db, {
      date: "2026-08-03", start: "15:00", end: "23:00", endDate: null,
      category: "shift", templateId: night, title: "Ночь", employeeId: null,
    });

    // Unconfigured: whoever is freest gets it — here the lower id.
    const before = await (await app.request("/api/admin/distribute", send(token, { from: "2026-08-01", to: "2026-08-31" }, "POST"))).json();
    expect(before.assignments[0].employeeId).toBe(inPool);

    // Now restrict the preset to the *other* person and re-run.
    await app.request(`/api/admin/templates/${night}/roles`, send(token, { pool: [outside] }));
    const after = await (await app.request("/api/admin/distribute", send(token, { from: "2026-08-01", to: "2026-08-31" }, "POST"))).json();
    expect(after.assignments[0].employeeId).toBe(outside);

    // And with the pool member on holiday, the slot stays open rather than
    // falling to somebody who doesn't do nights.
    createShift(db, {
      date: "2026-08-01", endDate: "2026-08-31", start: null, end: null,
      category: "vacation", templateId: null, title: null, employeeId: outside,
    });
    const away = await (await app.request("/api/admin/distribute", send(token, { from: "2026-08-01", to: "2026-08-31" }, "POST"))).json();
    expect(away.assignments).toEqual([]);
  });
});
