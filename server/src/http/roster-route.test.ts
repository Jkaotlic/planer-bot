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
      unknownsMessage: null,
      preservedCount: 0,
      existingCount: 0,
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
        entriesDeleted: 0,
        cellsPreserved: 0,
        unknowns: [],
      },
      unknownsMessage: null,
    });

    const exported = await app.request(
      "/api/admin/roster.csv?from=2026-08-01&to=2026-08-02",
      bearer(token),
    );
    const body = new TextDecoder().decode(await exported.arrayBuffer());
    expect(body).toContain("Игорь Петров;k32;holiday");
    expect(body).toContain("Новый Сотрудник;k32-7;holiday");
  });

  it("warns about an unreadable cell in the preview instead of refusing the file", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const badCsv = ";01.08.2026\r\nИгорь Петров;wat";

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: badCsv }),
    });

    // 200, not 422: one bad cell out of hundreds must not cost the whole month.
    expect(res.status).toBe(200);
    const body = await res.json();
    // The admin sees Russian naming the exact cell, not a machine string.
    expect(body.unknownsMessage).toMatch(/Игорь Петров/);
    expect(body.unknownsMessage).toMatch(/01\.08\.2026/);
    expect(body.unknownsMessage).toMatch(/wat/);
    expect(body.unknownsMessage).toMatch(/\?/);
    expect(body.unknowns).toEqual([{ name: "Игорь Петров", date: "2026-08-01", code: "wat" }]);
  });

  it("imports the unreadable cell as «?» and writes the original code back out", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const badCsv = ";01.08.2026;02.08.2026\r\nИгорь Петров;wat;k32";

    const applied = await app.request("/api/admin/roster/import/apply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: badCsv, resolutions: [{ csvName: "Игорь Петров", action: "create" }] }),
    });

    expect(applied.status).toBe(201);
    const body = await applied.json();
    // Both days are in — the readable one and the marked one.
    expect(body.summary.entriesInserted).toBe(2);
    expect(body.unknownsMessage).toMatch(/wat/);

    // Round trip: the export writes «wat» back, so re-uploading it warns again
    // rather than silently losing the cell or inventing a shift for it.
    const exported = await app.request("/api/admin/roster.csv?from=2026-08-01&to=2026-08-02", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await exported.text()).toContain("wat;k32");
  });

  it("accepts a '?' cell — it means «leave that day alone», not «bad code»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: ";01.08.2026;02.08.2026\r\nИгорь Петров;?;k32" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preservedCount).toBe(1);
    expect(body.entryCount).toBe(1);
    expect(body.unknowns).toEqual([]);
  });

  it("rejects a ragged row and names it the way Excel numbers it", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv: ";01.08.2026;02.08.2026\r\nИгорь Петров;k32;k32\r\nОбрезанный Пётр;k32" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/строка 3/);
    expect(body.error).toMatch(/Обрезанный Пётр/);
  });

  it("preview counts what already occupies the span so the admin can decide", async () => {
    const db = makeTestDb();
    const existing = worker(db, "Игорь Петров", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    createShift(db, {
      employeeId: existing.id, date: "2026-08-01", category: "shift",
      templateId: 2, start: "09:00", end: "18:00", title: "День",
    });

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ csv }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).existingCount).toBe(1);
  });

  it("refuses to apply over an occupied span, and says how much is there", async () => {
    const db = makeTestDb();
    const existing = worker(db, "Игорь Петров", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    createShift(db, {
      employeeId: existing.id, date: "2026-08-01", category: "shift",
      templateId: 2, start: "09:00", end: "18:00", title: "День",
    });

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

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ existingCount: 1, from: "2026-08-01", to: "2026-08-02" });
    expect(body.error).toMatch(/уже есть 1/);
  });

  it("applies over an occupied span when the admin confirms overwrite", async () => {
    const db = makeTestDb();
    const existing = worker(db, "Игорь Петров", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    createShift(db, {
      employeeId: existing.id, date: "2026-08-01", category: "shift",
      templateId: 4, start: "11:00", end: "20:00", title: "Вечер",
    });

    const res = await app.request("/api/admin/roster/import/apply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        csv,
        overwrite: true,
        resolutions: [
          { csvName: "Игорь Петров", action: "rename", employeeId: existing.id },
          { csvName: "Новый Сотрудник", action: "create" },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect((await res.json()).summary).toMatchObject({ entriesDeleted: 1, entriesInserted: 2 });
    const exported = await app.request("/api/admin/roster.csv?from=2026-08-01&to=2026-08-02", bearer(token));
    expect(new TextDecoder().decode(await exported.arrayBuffer())).toContain("Игорь Петров;k32;holiday");
  });

  it("rejects an oversized upload before parsing the body", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/roster/import/preview", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": String(50 * 1024 * 1024),
      },
      body: JSON.stringify({ csv }),
    });

    expect(res.status).toBe(413);
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

describe("the «?» entry is the import's alone", () => {
  it("cannot be created through the entries API", async () => {
    // The one work entry with no clock times exists only because a file said
    // something we could not read. An admin adding an entry by hand always knows
    // what it is, so the normal validation must keep insisting on times.
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const employee = worker(db, "Игорь Петров", 333);

    const res = await app.request("/api/admin/entries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-08-01", category: "shift", employeeId: employee.id, unrecognisedCode: "wat" }),
    });

    expect(res.status).toBe(400);
  });
});
