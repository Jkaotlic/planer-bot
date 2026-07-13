import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { getShift } from "../repo/shifts";
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

describe("admin entry endpoints", () => {
  it("creates, updates, and deletes an entry (admin only)", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request("/api/admin/entries", authedJson(admin, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: anya.id }));
    expect(created.status).toBe(201);
    const id = (await created.json()).entry.id as number;
    expect(getShift(db, id)?.employeeId).toBe(anya.id);

    const patched = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { category: "duty", location: "Вавилова" }, "PATCH"));
    expect(patched.status).toBe(200);
    expect((await patched.json()).entry.category).toBe("duty");

    const del = await app.request(`/api/admin/entries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
    expect(del.status).toBe(200);
    expect(getShift(db, id)).toBeUndefined();
  });

  it("rejects a worker (403) and validates the body (400)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 333);
    const app = createApp({ db, config });

    const worker = await tokenFor(app, 333);
    const forbidden = await app.request("/api/admin/entries", authedJson(worker, { date: "2026-07-10" }));
    expect(forbidden.status).toBe(403);

    const admin = await tokenFor(app, 111);
    const bad = await app.request("/api/admin/entries", authedJson(admin, { date: "nope" }));
    expect(bad.status).toBe(400);

    const missing = await app.request("/api/admin/entries/999", authedJson(admin, { note: "x" }, "PATCH"));
    expect(missing.status).toBe(404);
  });
});
