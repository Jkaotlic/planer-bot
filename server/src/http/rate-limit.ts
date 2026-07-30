import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./middleware";

export interface RateLimitOptions {
  /** Length of one counting window, in ms. */
  windowMs: number;
  /** Requests allowed per key per window before a 429. */
  max: number;
  /** Injectable clock — tests advance this instead of sleeping for real. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Best-effort client identity for keying, deliberately IP-only.
 *
 * It is tempting to fold in something like the Authorization bearer token so
 * concurrent sessions get separate budgets, but that value is entirely
 * client-supplied and unverified at this point in the pipeline (verification
 * happens downstream, in requireAuth/requireAdmin) — a flood that sends a
 * fresh made-up token on every request would mint a fresh bucket every time
 * and sail through uncounted. The raw TCP peer address Node itself observed
 * can't be forged that way, so that's the only signal used here.
 *
 * In this deployment, that guarantee is honest but not very useful: the app
 * sits behind KeenDNS's "Доступ к веб-приложениям" tunnel, which terminates
 * the public connection at the router and re-originates it locally — so this
 * will most likely resolve to the same address for every external client (see
 * the hardening report for the full reasoning). That's accepted rather than
 * worked around: the limits passed to rateLimiter() are sized as a shared
 * ceiling for the whole team's normal traffic, not a per-visitor allowance.
 */
function clientKey(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // getConnInfo needs the Node server adapter's raw socket, which isn't
    // present when a test drives the app via Hono's in-memory `app.request`.
    return "unknown";
  }
}

/**
 * Simple in-memory fixed-window rate limiter. State lives in this process's
 * memory — no store, no new dependency — which is fine because this app only
 * ever runs as a single instance (see index.ts: the same process also
 * long-polls Telegram, which is precisely what a flood here would starve).
 */
export function rateLimiter(opts: RateLimitOptions): MiddlewareHandler<Env> {
  const { windowMs, max } = opts;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  // Evict expired buckets periodically so a long-running process doesn't
  // accumulate one entry per distinct key forever. Cardinality here is
  // expected to stay tiny (see clientKey), so this is hygiene, not load-bearing.
  const sweepEveryMs = Math.max(windowMs * 10, 60_000);
  let lastSweep = now();
  function sweep(t: number): void {
    if (t - lastSweep < sweepEveryMs) return;
    lastSweep = t;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= t) buckets.delete(key);
    }
  }

  return async (c, next) => {
    const t = now();
    sweep(t);

    const key = clientKey(c);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "too_many_requests" }, 429);
    }

    await next();
  };
}
