import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { employees } from "../db/schema";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok",
  adminTelegramIds: [111],
  teamTz: "Europe/Moscow",
  databaseUrl: ":memory:",
  jwtSecret: "test-secret-16chars-min",
  publicUrl: "https://x.keenetic.pro",
  handoverFanHours: 3, handoverEscalateHours: 12,
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

  it("rejects an inactive (archived) employee at login when not on the allowlist (403)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-inactive" });
    linkTelegramAccount(db, "tok-inactive", 444); // 444 ∉ adminTelegramIds ([111])
    db.update(employees).set({ isActive: false }).where(eq(employees.id, w.id)).run();
    const res = await createApp({ db, config }).request(authReq(444));
    expect(res.status).toBe(403);
    expect(getEmployeeById(db, w.id)?.isActive).toBe(false); // still archived — no side effect
  });

  it("un-archives an allowlisted employee on login, so a locked-out admin can get back in", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-admin", isAdmin: true });
    linkTelegramAccount(db, "tok-admin", 111); // 111 ∈ adminTelegramIds
    db.update(employees).set({ isActive: false }).where(eq(employees.id, w.id)).run();

    const res = await createApp({ db, config }).request(authReq(111));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.id).toBe(w.id);
    expect(body.employee.isAdmin).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(getEmployeeById(db, w.id)?.isActive).toBe(true);
  });

  it("un-archives and grants admin to an allowlisted employee who wasn't previously an admin", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-worker" }); // isAdmin: false
    linkTelegramAccount(db, "tok-worker", 111); // 111 ∈ adminTelegramIds
    db.update(employees).set({ isActive: false }).where(eq(employees.id, w.id)).run();

    const res = await createApp({ db, config }).request(authReq(111));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.isAdmin).toBe(true);
    expect(getEmployeeById(db, w.id)?.isActive).toBe(true);
    expect(getEmployeeById(db, w.id)?.isAdmin).toBe(true);
  });

  // The odd one out: an *archived* allowlisted worker is promoted (above), a new
  // one is created as an admin — but an active worker already in the database was
  // only told `isAdmin: true` in the response, while the guards read the row and
  // 403'd every admin request. Fail-closed, and a lie in the contract.
  it("grants admin to an active allowlisted employee instead of only claiming to", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok-active" }); // isAdmin: false
    linkTelegramAccount(db, "tok-active", 111); // 111 ∈ adminTelegramIds
    const app = createApp({ db, config });

    const res = await app.request(authReq(111));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.isAdmin).toBe(true);
    expect(getEmployeeById(db, w.id)?.isAdmin).toBe(true);

    // And the token it just handed out actually opens an admin route.
    const admin = await app.request("/api/admin/employees", { headers: { Authorization: `Bearer ${body.token}` } });
    expect(admin.status).toBe(200);
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

describe("rate limiting", () => {
  it("/api/auth trips its own tight limiter (1,200/min) well before the general one (8,000/min)", async () => {
    const app = createApp({ db: makeTestDb(), config });
    // A real flood still gets capped: the 1,201st POST /api/auth in the same
    // 60s window is rejected. See app.ts for the arithmetic behind 1,200 —
    // it's >10x the worst realistic minute (the whole grown team logging in
    // at once, each with a retry), so nothing short of an actual flood can
    // reach this.
    let last!: Response;
    for (let i = 0; i < 1_201; i++) last = await app.request(authReq(111 + i));
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "too_many_requests" });
    expect(last.headers.get("Retry-After")).toBeTruthy();
  });

  it("the whole team opening the mini app within the same minute never trips the general limiter", async () => {
    // This is the actual scenario the general limit is sized against: shift
    // reminders go out after 20:00, and that predictably lands a burst of
    // people opening the app within the same minute. Every request in this
    // test lands on the same rate-limit key — like the real deployment
    // behind KeenDNS, which likely presents every external client as one
    // address (see rate-limit.ts) — so this is the realistic worst case, not
    // an understatement of it.
    //
    // 30 employees (today's full roster), each doing exactly what
    // miniapp/src/App.tsx's bootstrap effect does — getMe + 6 parallel calls
    // — plus two tab switches worth of reloadData (6 calls each, everything
    // but getMe): 1 login + 7 + 12 = 20 requests per person, 600 total.
    const db = makeTestDb();
    const app = createApp({ db, config });

    const from = "2026-01-05";
    const to = "2026-01-11";
    const bootstrapPaths = [
      "/api/me",
      `/api/my/shifts?from=${from}`,
      `/api/team/schedule?from=${from}&to=${to}`,
      "/api/templates",
      "/api/swaps",
      "/api/weekend/slots",
      "/api/weekend/offers",
    ];
    const reloadPaths = bootstrapPaths.slice(1); // reloadData re-pulls everything but getMe

    const employees = Array.from({ length: 30 }, (_, i) => {
      const tgId = 5000 + i;
      const inviteToken = `inv-rl-${i}`;
      createEmployee(db, { displayName: `Сотрудник ${i}`, inviteToken });
      linkTelegramAccount(db, inviteToken, tgId);
      return tgId;
    });

    const oneEmployeeSession = async (tgId: number): Promise<Response[]> => {
      // Logging in is part of "opening the app" too, and counts against the
      // same general limiter — captured here so it's included below.
      const loginRes = await app.request(authReq(tgId));
      const token = ((await loginRes.json()) as { token: string }).token;
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const calls = [...bootstrapPaths, ...reloadPaths, ...reloadPaths].map((path) => app.request(path, auth));
      return [loginRes, ...(await Promise.all(calls))];
    };

    const results = (await Promise.all(employees.map(oneEmployeeSession))).flat();
    expect(results.length).toBe(30 * 20);
    for (const res of results) expect(res.status).toBe(200);
  });
});
