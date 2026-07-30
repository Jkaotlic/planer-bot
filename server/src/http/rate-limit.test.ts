import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimiter } from "./rate-limit";

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
    expect(await res.json()).toEqual({ error: "too_many_requests" });
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
