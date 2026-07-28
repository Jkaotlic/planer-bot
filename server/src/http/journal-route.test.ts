import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { createShift } from "../repo/shifts";
import { recordAudit } from "../repo/audit";
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
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const presetId = (db: Db, name: string) => listActiveTemplates(db).find((t) => t.name === name)!.id;

describe("GET /api/admin/journal", () => {
  it("returns newest first, with the actor's name resolved", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const actor = createEmployee(db, { displayName: "Аня" }).id;

    recordAudit(db, "entry_created", actor, { entryId: 1 });
    recordAudit(db, "entry_deleted", actor, { entryId: 1 });

    const res = await app.request("/api/admin/journal", auth(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(["entry_deleted", "entry_created"]);
    expect(body.events[0].actorName).toBe("Аня");
    expect(body.total).toBe(2);
  });

  it("filters by type, and offers only the types actually present", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    recordAudit(db, "entry_created", null, {});
    recordAudit(db, "entry_created", null, {});
    recordAudit(db, "roster_import", null, {});

    const filtered = await (await app.request("/api/admin/journal?types=roster_import", auth(token))).json();
    expect(filtered.total).toBe(1);
    expect(filtered.events).toHaveLength(1);

    const all = await (await app.request("/api/admin/journal", auth(token))).json();
    expect(all.availableTypes).toEqual(["entry_created", "roster_import"]);
  });

  it("accepts several types at once", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    recordAudit(db, "entry_created", null, {});
    recordAudit(db, "entry_updated", null, {});
    recordAudit(db, "roster_import", null, {});

    const res = await (await app.request("/api/admin/journal?types=entry_created,entry_updated", auth(token))).json();
    expect(res.total).toBe(2);
  });

  it("pages: total counts everything matching, not just this page", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    for (let i = 0; i < 7; i++) recordAudit(db, "entry_created", null, { i });

    const first = await (await app.request("/api/admin/journal?limit=3", auth(token))).json();
    expect(first.events).toHaveLength(3);
    expect(first.total).toBe(7);

    const second = await (await app.request("/api/admin/journal?limit=3&offset=3", auth(token))).json();
    expect(second.events).toHaveLength(3);
    expect(second.events[0].id).not.toBe(first.events[0].id);

    const last = await (await app.request("/api/admin/journal?limit=3&offset=6", auth(token))).json();
    expect(last.events).toHaveLength(1);
  });

  it("rejects a malformed or reversed date range", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    expect((await app.request("/api/admin/journal?from=вчера", auth(token))).status).toBe(400);
    expect((await app.request("/api/admin/journal?from=2026-02-30", auth(token))).status).toBe(400);
    expect((await app.request("/api/admin/journal?from=2026-08-05&to=2026-08-01", auth(token))).status).toBe(400);
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Работник", inviteToken: "inv-1" });
    linkTelegramAccount(db, "inv-1", 222);
    expect((await app.request("/api/admin/journal", auth(await tokenFor(app, 222)))).status).toBe(403);
  });
});

describe("GET /api/admin/reports/shift-counts", () => {
  const seed = (db: Db) => {
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;
    const day = presetId(db, "День");
    const phone = presetId(db, "Дежурство · Телефон");
    createShift(db, { employeeId: a, date: "2026-06-01", endDate: null, category: "shift", templateId: day, start: "09:00", end: "18:00", title: "День" });
    createShift(db, { employeeId: a, date: "2026-06-02", endDate: null, category: "duty", templateId: phone, start: "09:00", end: "18:00", title: "Дежурство · Телефон" });
    createShift(db, { employeeId: b, date: "2026-06-03", endDate: null, category: "shift", templateId: day, start: "09:00", end: "18:00", title: "День" });
    return { a, b };
  };

  it("returns the table people × kinds", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    seed(db);

    const res = await app.request("/api/admin/reports/shift-counts?from=2026-06-01&to=2026-06-30", auth(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kinds).toEqual(["День", "Дежурство · Телефон"]);
    const first = body.rows.find((r: { displayName: string }) => r.displayName === "Первый");
    expect(first).toMatchObject({ total: 2, byKind: { "День": 1, "Дежурство · Телефон": 1 } });
  });

  it("downloads the same table as an Excel-readable CSV", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    seed(db);

    const res = await app.request("/api/admin/reports/shift-counts.csv?from=2026-06-01&to=2026-06-30", auth(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM, or Excel mangles Cyrillic
    expect(new TextDecoder().decode(bytes)).toContain("Работник;День;Дежурство · Телефон;Всего");
  });

  it("validates the range like every other ranged report", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    expect((await app.request("/api/admin/reports/shift-counts", auth(token))).status).toBe(400);
    expect((await app.request("/api/admin/reports/shift-counts?from=2026-06-30&to=2026-06-01", auth(token))).status).toBe(400);
    expect((await app.request("/api/admin/reports/shift-counts?from=2020-01-01&to=2026-12-31", auth(token))).status).toBe(400);
  });
});
