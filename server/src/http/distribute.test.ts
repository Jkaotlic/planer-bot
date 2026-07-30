import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

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
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("POST /api/admin/distribute", () => {
  it("previews by default (no writes) and applies when apply:true", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const preview = await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01", to: "2026-07-10" }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.applied).toBe(false);
    expect(previewBody.assignments.length).toBe(1);
    expect(getShift(db, s1.id)?.employeeId).toBeNull(); // not applied

    const applied = await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01", to: "2026-07-10", apply: true }));
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.applied).toBe(true);
    expect(appliedBody.assignments.length).toBe(1);
    expect(getShift(db, s1.id)?.employeeId).not.toBeNull(); // applied
  });

  // Every other way the schedule changes lands in «кто когда что менял» — an entry
  // typed in, a weekend slot assigned, a pool edited. Distribution moves a whole week
  // at once, so it is the last thing that should be invisible there.
  it("records the applied distribution in the journal, and a preview records nothing", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01", to: "2026-07-10" }));
    expect(listRecentAudit(db, 10)).toEqual([]);

    await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01", to: "2026-07-10", apply: true }));
    const [event, ...rest] = listRecentAudit(db, 10);
    expect(rest).toEqual([]);
    expect(event?.type).toBe("distribution_applied");
    expect(event?.payload).toEqual({ from: "2026-07-01", to: "2026-07-10", count: 1 });
  });

  it("rejects a worker (403) and validates from/to (400)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 333);
    const app = createApp({ db, config });

    const worker = await tokenFor(app, 333);
    const forbidden = await app.request("/api/admin/distribute", authedJson(worker, { from: "2026-07-01", to: "2026-07-10" }));
    expect(forbidden.status).toBe(403);

    const admin = await tokenFor(app, 111);
    const bad = await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01" }));
    expect(bad.status).toBe(400);
  });
});
