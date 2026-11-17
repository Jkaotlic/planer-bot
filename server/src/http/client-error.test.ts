import { describe, it, expect, vi } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createApp } from "./app";
import { describeClientError } from "./client-error";

const config = { jwtSecret: "s", teamTz: "Europe/Moscow", publicUrl: "http://x", adminTelegramIds: [] } as any;

describe("описание сбоя запуска", () => {
  it("ставит рядом устройство, причину и путь страницы", () => {
    const line = describeClientError({
      reason: "SyntaxError: Unexpected token '??='",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X)",
      url: "https://example.com/app/?screen=sick",
    });

    expect(line).toContain("SyntaxError");
    expect(line).toContain("iPhone OS 15_8");
    expect(line).toContain("https://example.com/app/");
    expect(line).not.toContain("screen=sick");
  });

  it("обрезает длинные поля — это единственная неаутентифицированная ручка, лог не должен раздуваться", () => {
    const line = describeClientError({
      reason: "я".repeat(5_000),
      userAgent: "б".repeat(5_000),
      url: "в".repeat(5_000),
    });

    expect(line.length).toBeLessThan(1_200);
  });

  it("переживает мусор вместо полей — клиент, который это шлёт, уже сломан", () => {
    expect(() => describeClientError({ reason: 42, userAgent: null, url: undefined } as never)).not.toThrow();
    expect(() => describeClientError(null as never)).not.toThrow();
  });
});

describe("POST /api/client-error", () => {
  it("принимает отчёт без токена — на белом экране входа ещё нет", async () => {
    const app = createApp({ db: makeTestDb(), config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await app.request("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "экран остался пустым", userAgent: "iPhone OS 15_8", url: "/app/" }),
    });

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("iPhone OS 15_8");
    warn.mockRestore();
  });

  it("на битое тело всё равно отвечает 204 — иначе сломанный клиент получит ещё и ошибку", async () => {
    const app = createApp({ db: makeTestDb(), config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await app.request("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "не json вовсе",
    });

    expect(res.status).toBe(204);
    warn.mockRestore();
  });

  it("не пишет в лог параметры Telegram и не принимает поддельную строку лога", async () => {
    const app = createApp({ db: makeTestDb(), config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await app.request("/api/client-error", {
        method: "POST",
        body: JSON.stringify({
          reason: "сбой\r\nПоддельная запись",
          userAgent: "iPhone OS 15_8\u001b",
          url: "https://example.com/app/?secret=abc#tgWebAppData=synthetic",
        }),
      });

      expect(res.status).toBe(204);
      const line = warn.mock.calls[0]?.join(" ");
      expect(line).toContain("адрес: https://example.com/app/");
      expect(line).not.toMatch(/secret|tgWebAppData|[\r\n]|\u001b/);
    } finally {
      warn.mockRestore();
    }
  });
});
