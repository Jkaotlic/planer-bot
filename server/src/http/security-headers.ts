import type { MiddlewareHandler } from "hono";
import type { Env } from "./middleware";

// The origins Telegram Web actually uses to embed a Mini App in an iframe (the
// page at web.telegram.org loads the app at /app/ inside an <iframe> and talks
// to it over postMessage with one of these as targetOrigin). Verified against
// Telegram's own Mini Apps docs/SDK rather than assumed — Telegram Desktop and
// mobile clients open the app in a native webview (a top-level load, not a
// framed one), so they aren't affected by frame-ancestors either way; only the
// web client actually frames the page.
const TELEGRAM_WEB_ORIGINS = [
  "https://web.telegram.org",
  // Отдельные сборки того же веб-клиента, K и A, живут на своих доменах и
  // рамку создают от своего имени. Пока их тут не было, у того, кто открывает
  // Telegram оттуда, мини-апп не открывался вовсе: браузер отказывает во
  // встраивании молча, и человек видел пустой прямоугольник — тот же белый
  // экран, что и во всех остальных поломках, только без единой ошибки в консоли
  // приложения, потому что приложение и не запускалось.
  "https://webk.telegram.org",
  "https://weba.telegram.org",
].join(" ");

function isUnderPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Security headers for every response this process serves.
 *
 * Framing policy is the one thing that has to differ by path — see the note
 * on TELEGRAM_WEB_ORIGINS above:
 *   - /admin/*  — a desktop console nobody legitimately frames: denied outright.
 *   - /app/*    — the Telegram Mini App, which *must* stay framable by Telegram
 *                 Web or it breaks there. X-Frame-Options has no "allow this
 *                 one origin" value (only DENY/SAMEORIGIN), so it is left unset
 *                 here and CSP's frame-ancestors — which does support an
 *                 origin list — carries the whole job.
 *   - everything else (API responses, stray paths) — same deny as /admin/,
 *     since none of it is meant to be embedded either.
 *
 * The rest of the CSP is deliberately minimal: both frontends lean on
 * @telegram-apps/telegram-ui and inline styles, so a strict style-src/script-src
 * would break the UI and hasn't been verified safe. object-src 'none' and
 * base-uri 'self' are added because they're inert for both apps (neither uses
 * <object>/<embed> or relies on a non-default <base>) while still closing off
 * two classic injection vectors — everything else is left out rather than
 * guessed at.
 */
export function securityHeaders(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();

    // HSTS: this server is only ever reached over the public HTTPS origin (or
    // localhost in dev, where a browser never sends the header's downgrade
    // instruction anywhere that matters). includeSubDomains is safe here —
    // the public hostname has no subdomains of its own to break.
    c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    c.header("X-Content-Type-Options", "nosniff");
    // Fragments (like the admin link's #token=...) are never sent in a Referer
    // header by any browser — that part of the URL never leaves the client.
    // What can leak is the *path* to a third-party resource embedded on the
    // page; this keeps cross-origin referrers to origin-only and same-origin
    // ones full, which is the modern browser default made explicit.
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");

    const path = c.req.path;
    if (isUnderPrefix(path, "/app")) {
      c.header(
        "Content-Security-Policy",
        `frame-ancestors 'self' ${TELEGRAM_WEB_ORIGINS}; object-src 'none'; base-uri 'self'`,
      );
    } else {
      c.header("X-Frame-Options", "DENY");
      c.header("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    }
  };
}
