import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { testConfig } from "../test-config";

const config = testConfig();

const app = () => createApp({ db: makeTestDb(), config });

describe("security headers", () => {
  it("sets HSTS, nosniff and a referrer policy on every response, admin or app", async () => {
    for (const path of ["/api/health", "/admin/", "/app/"]) {
      const res = await app().request(path);
      expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
      expect(res.headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    }
  });

  it("denies framing outright on /admin/ — a desktop console nobody legitimately frames", async () => {
    const res = await app().request("/admin/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("also denies framing on plain API/unknown paths by default", async () => {
    const res = await app().request("/api/health");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("/app/ is NOT frame-denied — Telegram Web must still be able to embed it", async () => {
    const res = await app().request("/app/");
    // No X-Frame-Options here: it can't express "allow this one origin", and
    // DENY/SAMEORIGIN would break the mini app inside Telegram Web's iframe.
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-ancestors 'self' https://web.telegram.org");
  });

  // Отдельные сборки веб-клиента живут на своих доменах, и рамка оттуда —
  // не web.telegram.org. Кто пользуется ими, получал пустой прямоугольник:
  // браузер отказывает во встраивании молча, без единого слова на экране.
  it("веб-клиент на отдельных доменах тоже должен уметь встроить мини-апп", async () => {
    const csp = (await app().request("/app/")).headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://webk.telegram.org");
    expect(csp).toContain("https://weba.telegram.org");
  });

  it("/app/<anything> (sub-paths) get the same app-friendly framing policy", async () => {
    const res = await app().request("/app/some/deep/route");
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("web.telegram.org");
  });

  it("a path that merely starts with /app (not /app/) is not mistaken for it", async () => {
    // Guards against a naive startsWith("/app") match also catching e.g. /apples.
    const res = await app().request("/appfoo");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("keeps object-src and base-uri locked down on both /admin/ and /app/", async () => {
    const admin = await app().request("/admin/");
    const miniapp = await app().request("/app/");
    for (const res of [admin, miniapp]) {
      const csp = res.headers.get("Content-Security-Policy")!;
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    }
  });
});
