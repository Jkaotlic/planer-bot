import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./middleware";
import { verifyToken } from "../auth/jwt";

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
 * The TCP peer address Node itself observed — the key for everything that has no
 * verified token (see `teamRateLimiter` for those that do).
 *
 * The raw Authorization header must never be folded in here: it is entirely
 * client-supplied, and a flood that sends a fresh made-up token on every
 * request would mint a fresh bucket every time and sail through uncounted. The
 * peer address can't be forged that way.
 *
 * In this deployment that guarantee is honest but coarse: the app sits behind
 * KeenDNS's "Доступ к веб-приложениям" tunnel, which terminates the public
 * connection at the router and re-originates it locally — so this most likely
 * resolves to the same address for every external client (see the hardening
 * report). An address bucket is therefore a shared ceiling for the whole team,
 * not a per-visitor allowance, and its numbers are sized that way.
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
 * Fixed-window counters, in this process's memory — no store, no new dependency —
 * which is fine because this app only ever runs as a single instance (see
 * index.ts: the same process also long-polls Telegram, which is precisely what a
 * flood here would starve). Each limiter owns its own map: two limiters never
 * share a budget.
 */
function fixedWindow(windowMs: number, now: () => number) {
  const buckets = new Map<string, Bucket>();

  // Evict expired buckets periodically so a long-running process doesn't
  // accumulate one entry per distinct key forever. Keys are addresses and
  // employee ids — a few dozen at most — so this is hygiene, not load-bearing.
  const sweepEveryMs = Math.max(windowMs * 10, 60_000);
  let lastSweep = now();
  function sweep(t: number): void {
    if (t - lastSweep < sweepEveryMs) return;
    lastSweep = t;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= t) buckets.delete(key);
    }
  }

  /** Counts one request against `key`; returns a 429 response once it's over `max`. */
  return (c: Context, key: string, max: number): Response | null => {
    const t = now();
    sweep(t);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= max) return null;
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
    c.header("Retry-After", String(retryAfterSec));
    return c.json({ error: "too_many_requests" }, 429);
  };
}

/** Limiter keyed by address alone — for the public routes with their own tighter window. */
export function rateLimiter(opts: RateLimitOptions): MiddlewareHandler<Env> {
  const hit = fixedWindow(opts.windowMs, opts.now ?? Date.now);
  return async (c, next) => {
    const refused = hit(c, `ip:${clientKey(c)}`, opts.max);
    if (refused) return refused;
    await next();
  };
}

export interface TeamRateLimitOptions {
  windowMs: number;
  /** Shared ceiling for everything without a verified token — one bucket per address. */
  ipMax: number;
  /** Per-person ceiling for `/api/*` carrying a verified token. */
  employeeMax: number;
  /** JWT secret — the key comes only from a token this server signed. */
  secret: string;
  now?: () => number;
}

/**
 * Пути, которые считаются по адресу, даже если в запросе есть живой токен.
 * `/api/auth` — вход: токена у входящего ещё нет, и личная корзина тут ничего не
 * значила бы. `/api/client-error` — публичный отчёт «не открылось», токен там не
 * проверяется вовсе. `/cal/*` вне `/api` и ходит без заголовка — по ссылке-токену.
 */
const IP_ONLY_API_PATHS = new Set(["/api/auth", "/api/client-error"]);

/**
 * Общий лимитер приложения: человек с проверенным токеном — своя корзина, всё
 * остальное — корзина по адресу.
 *
 * Зачем: за релеем KeenDNS все внешние клиенты приходят с одного адреса (см.
 * `clientKey`), и общая IP-корзина делала одного зациклившегося клиента бедой
 * всей команды — его поток давал 429 всем сразу.
 *
 * Ключ берётся только из токена, который этот сервер подписал и который ещё не
 * истёк, — проверка подписи здесь же, до любых ручек. Иначе поток со свежим
 * выдуманным токеном на каждый запрос получал бы свежую корзину и не считался
 * вовсе. Мусорный, чужой и просроченный токен идёт в корзину по адресу — ту же,
 * что и запрос без токена. Активность сотрудника в базе здесь не смотрится: это
 * дело `requireAuth`, а для подсчёта хватает того, что токен выпущен нами и
 * число таких ключей ограничено ростером.
 *
 * Корзины раздельные: запросы с токеном не тратят общую IP-корзину, иначе
 * зациклившийся клиент снова съедал бы общий бюджет статики и входа.
 */
export function teamRateLimiter(opts: TeamRateLimitOptions): MiddlewareHandler<Env> {
  const hit = fixedWindow(opts.windowMs, opts.now ?? Date.now);
  return async (c, next) => {
    const employeeId = await verifiedEmployeeId(c, opts.secret);
    const refused =
      employeeId === null ? hit(c, `ip:${clientKey(c)}`, opts.ipMax) : hit(c, `employee:${employeeId}`, opts.employeeMax);
    if (refused) return refused;
    await next();
  };
}

async function verifiedEmployeeId(c: Context, secret: string): Promise<number | null> {
  const path = c.req.path;
  if (!path.startsWith("/api/") || IP_ONLY_API_PATHS.has(path)) return null;
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { employeeId } = await verifyToken(header.slice(7), secret);
    return Number.isInteger(employeeId) ? employeeId : null;
  } catch {
    return null;
  }
}
