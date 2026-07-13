import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok",
  adminTelegramIds: [111],
  teamTz: "Europe/Moscow",
  databaseUrl: ":memory:",
  jwtSecret: "test-secret-16chars-min",
  publicUrl: "https://x.keenetic.pro",
};

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

const authReq = (id: number) =>
  new Request("http://x/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: initDataFor(id) }),
  });

describe("app auth", () => {
  it("serves public health", async () => {
    const res = await createApp({ db: makeTestDb(), config }).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("bootstraps an allowlisted admin and issues a token", async () => {
    const res = await createApp({ db: makeTestDb(), config }).request(authReq(111));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.isAdmin).toBe(true);
    expect(typeof body.token).toBe("string");
  });

  it("rejects an unregistered non-admin (403)", async () => {
    const res = await createApp({ db: makeTestDb(), config }).request(authReq(222));
    expect(res.status).toBe(403);
  });

  it("logs in a pre-registered, linked worker (not admin)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 333);
    const res = await createApp({ db, config }).request(authReq(333));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.id).toBe(w.id);
    expect(body.employee.isAdmin).toBe(false);
  });

  it("/api/me needs a token and returns the caller", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = (await (await app.request(authReq(111))).json()).token as string;
    const ok = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).isAdmin).toBe(true);
    const no = await app.request("/api/me");
    expect(no.status).toBe(401);
  });
});
