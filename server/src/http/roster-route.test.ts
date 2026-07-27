import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
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

describe("GET /api/admin/roster.csv", () => {
  it("returns a BOM-prefixed CSV attachment to an admin", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/admin/roster.csv?from=2026-06-01&to=2026-06-30",
      bearer(await tokenFor(app, 111)), // allowlisted admin — no employee row needed
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="roster-2026-06-01_2026-06-30\.csv"$/);

    // Response#text() decodes as UTF-8 and silently drops a leading BOM (and .trim() would
    // strip it too, since JS treats U+FEFF as whitespace) — inspect the raw bytes instead.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("rejects a missing 'from' or 'to' with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const noFrom = await app.request("/api/admin/roster.csv?to=2026-06-30", admin);
    expect(noFrom.status).toBe(400);
    const noTo = await app.request("/api/admin/roster.csv?from=2026-06-01", admin);
    expect(noTo.status).toBe(400);
  });

  it("rejects a malformed date with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const res = await app.request("/api/admin/roster.csv?from=2026-02-30&to=2026-06-30", admin);
    expect(res.status).toBe(400);
  });

  it("rejects 'from' after 'to' with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const res = await app.request("/api/admin/roster.csv?from=2026-06-30&to=2026-06-01", admin);
    expect(res.status).toBe(400);
  });

  it("rejects a valid but over-long span with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    // Both dates are individually valid — this exercises the span check itself,
    // not the date-validity branch.
    const res = await app.request("/api/admin/roster.csv?from=2025-01-01&to=2026-12-31", admin);
    expect(res.status).toBe(400);
  });

  it("accepts a span of exactly 366 days (inclusive boundary)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const res = await app.request("/api/admin/roster.csv?from=2026-01-01&to=2027-01-02", admin);
    expect(res.status).toBe(200);
  });

  it("rejects a span of 367 days with 400", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const res = await app.request("/api/admin/roster.csv?from=2026-01-01&to=2027-01-03", admin);
    expect(res.status).toBe(400);
  });

  it("still returns 200 for a normal month", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = bearer(await tokenFor(app, 111));
    const res = await app.request("/api/admin/roster.csv?from=2026-06-01&to=2026-06-30", admin);
    expect(res.status).toBe(200);
  });

  it("forbids a non-admin worker (403)", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/admin/roster.csv?from=2026-06-01&to=2026-06-30",
      bearer(await tokenFor(app, 333)),
    );
    expect(res.status).toBe(403);
  });
});

describe("admin roster CSV import", () => {
  const csv = "\uFEFF;01.08.2026;02.08.2026\r\nИгорь Петров;k32;holiday\r\nНовый Сотрудник;k32-7;holiday";

  it("previews the period, entries and exact-name employee suggestion without writing", async () => {
    const db = makeTestDb();
    const existing = worker(db, "Игорь Петров", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      from: "2026-08-01",
      to: "2026-08-02",
      entryCount: 2,
      people: [
        { csvName: "Игорь Петров", suggestedEmployeeId: existing.id },
        { csvName: "Новый Сотрудник", suggestedEmployeeId: null },
      ],
      unknowns: [],
    });

    const exported = await app.request(
      "/api/admin/roster.csv?from=2026-08-01&to=2026-08-02",
      bearer(token),
    );
    expect(new TextDecoder().decode(await exported.arrayBuffer())).not.toContain("Новый Сотрудник");
  });

  it("applies confirmed resolutions atomically and returns a summary", async () => {
    const db = makeTestDb();
    const existing = worker(db, "Игорь Петров", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/roster/import/apply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        csv,
        resolutions: [
          { csvName: "Игорь Петров", action: "rename", employeeId: existing.id },
          { csvName: "Новый Сотрудник", action: "create" },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      summary: {
        employeesRenamed: 1,
        employeesCreated: 1,
        entriesInserted: 2,
        unknowns: [],
      },
    });

    const exported = await app.request(
      "/api/admin/roster.csv?from=2026-08-01&to=2026-08-02",
      bearer(token),
    );
    const body = new TextDecoder().decode(await exported.arrayBuffer());
    expect(body).toContain("Игорь Петров;k32;holiday");
    expect(body).toContain("Новый Сотрудник;k32-7;holiday");
  });

  it("rejects a preview containing unknown roster codes", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const badCsv = ";01.08.2026\r\nИгорь Петров;wat";

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: badCsv }),
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "unknown_roster_codes",
      unknowns: [{ name: "Игорь Петров", date: "2026-08-01", code: "wat" }],
    });
  });

  it("rejects duplicate employee names before showing the preview", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const duplicateCsv = ";01.08.2026\r\nИгорь Петров;k32\r\nИгорь Петров;k32-7";

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: duplicateCsv }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "в CSV повторяется ФИО «Игорь Петров»" });
  });
});
