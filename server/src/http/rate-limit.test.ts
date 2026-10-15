import { describe, it, expect } from "vitest";
import { TOO_MANY_REQUESTS_TEXT } from "./rate-limit";
import { Hono } from "hono";
import { rateLimiter, teamRateLimiter } from "./rate-limit";
import { issueToken } from "../auth/jwt";

/** A minimal app wrapping the limiter alone, with an injectable clock so tests
 *  can advance time deterministically instead of sleeping for real. */
function appWithLimiter(opts: { windowMs: number; max: number }) {
  let clock = 0;
  const app = new Hono();
  app.use("*", rateLimiter({ ...opts, now: () => clock }));
  app.get("/x", (c) => c.text("ok"));
  return { app, advance: (ms: number) => (clock += ms) };
}

describe("rateLimiter", () => {
  it("allows requests under the limit", async () => {
    const { app } = appWithLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/x");
      expect(res.status).toBe(200);
    }
  });

  it("blocks with 429 once the limit is exceeded within a window", async () => {
    const { app } = appWithLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) await app.request("/x");
    const res = await app.request("/x");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: TOO_MANY_REQUESTS_TEXT });
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("recovers once the window rolls over", async () => {
    const { app, advance } = appWithLimiter({ windowMs: 60_000, max: 2 });
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(429); // limit hit

    advance(60_000); // window rolls over
    expect((await app.request("/x")).status).toBe(200); // fresh budget
  });

  it("a normal burst of legitimate requests (well under the loose limit) never trips it", async () => {
    // Mirrors the admin console firing off a dozen-odd parallel GETs on open.
    const { app } = appWithLimiter({ windowMs: 60_000, max: 300 });
    const results = await Promise.all(Array.from({ length: 20 }, () => app.request("/x")));
    for (const res of results) expect(res.status).toBe(200);
  });

  it("keys are independent — two limiter instances don't share state", async () => {
    const { app: a } = appWithLimiter({ windowMs: 60_000, max: 1 });
    const { app: b } = appWithLimiter({ windowMs: 60_000, max: 1 });
    expect((await a.request("/x")).status).toBe(200);
    expect((await a.request("/x")).status).toBe(429);
    // b has its own bucket, untouched by a's traffic.
    expect((await b.request("/x")).status).toBe(200);
  });
});

/**
 * Общий лимитер приложения. За релеем KeenDNS все приходят с одного адреса, поэтому
 * IP-корзина у команды одна на всех — и один зациклившийся клиент отрезал бы всех.
 * С проверенным токеном человек считается своей корзиной; без него — общей по адресу.
 */
describe("teamRateLimiter", () => {
  const secret = "test-secret-rate-limit-0123456789";

  function teamApp(opts: { ipMax: number; employeeMax: number }) {
    let clock = 0;
    const app = new Hono();
    app.use("*", teamRateLimiter({ windowMs: 60_000, secret, now: () => clock, ...opts }));
    app.all("*", (c) => c.text("ok"));
    return { app, advance: (ms: number) => (clock += ms) };
  }
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
  const tokenOf = (employeeId: number) => issueToken({ employeeId, isAdmin: false }, secret);

  it("два сотрудника не делят корзину: Аня упёрлась — Игорь работает", async () => {
    const { app } = teamApp({ ipMax: 1_000, employeeMax: 2 });
    const anya = bearer(await tokenOf(1));
    const igor = bearer(await tokenOf(2));
    expect((await app.request("/api/me", anya)).status).toBe(200);
    expect((await app.request("/api/me", anya)).status).toBe(200);
    expect((await app.request("/api/me", anya)).status).toBe(429);
    expect((await app.request("/api/me", igor)).status).toBe(200);
  });

  it("трафик с проверенным токеном не съедает общую IP-корзину", async () => {
    const { app } = teamApp({ ipMax: 1, employeeMax: 100 });
    const anya = bearer(await tokenOf(1));
    for (let i = 0; i < 5; i++) expect((await app.request("/api/me", anya)).status).toBe(200);
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("мусорный токен не даёт свежей корзины — каждый новый идёт в общую IP-корзину", async () => {
    const { app } = teamApp({ ipMax: 2, employeeMax: 100 });
    expect((await app.request("/api/me", bearer("garbage-1"))).status).toBe(200);
    expect((await app.request("/api/me", bearer("garbage-2"))).status).toBe(200);
    expect((await app.request("/api/me", bearer("garbage-3"))).status).toBe(429);
  });

  it("чужая подпись и просроченный токен — тоже в IP-корзину", async () => {
    const { app } = teamApp({ ipMax: 2, employeeMax: 100 });
    const forged = await issueToken({ employeeId: 7, isAdmin: true }, "another-secret-0123456789abcdef");
    const expired = await issueToken({ employeeId: 8, isAdmin: false }, secret, 60, Math.floor(Date.now() / 1000) - 3_600);
    expect((await app.request("/api/me", bearer(forged))).status).toBe(200);
    expect((await app.request("/api/me", bearer(expired))).status).toBe(200);
    expect((await app.request("/api/me", bearer(forged))).status).toBe(429);
  });

  it("/api/auth, /api/client-error и /cal/* считаются по адресу даже с живым токеном", async () => {
    for (const path of ["/api/auth", "/api/client-error", "/cal/abc.ics"]) {
      const { app } = teamApp({ ipMax: 1, employeeMax: 100 });
      const anya = bearer(await tokenOf(1));
      expect((await app.request(path, { method: "POST", ...anya })).status, path).toBe(200);
      expect((await app.request(path, { method: "POST", ...anya })).status, path).toBe(429);
    }
  });

  it("корзина сотрудника оживает со сменой окна", async () => {
    const { app, advance } = teamApp({ ipMax: 1_000, employeeMax: 1 });
    const anya = bearer(await tokenOf(1));
    expect((await app.request("/api/me", anya)).status).toBe(200);
    const blocked = await app.request("/api/me", anya);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    advance(60_000);
    expect((await app.request("/api/me", anya)).status).toBe(200);
  });
});

describe("текст отказа 429", () => {
  it("по-русски и с тем, что делать: обе морды показывают error как есть", () => {
    expect(TOO_MANY_REQUESTS_TEXT).toBe("Слишком много запросов — подожди минуту и повтори.");
  });
});
