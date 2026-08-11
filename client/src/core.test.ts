import { describe, expect, it, vi } from "vitest";
import { AuthRequiredError, OFFLINE_MESSAGE, createTransport } from "./core";

const source = (token = "t") => ({ get: async () => token, clear: vi.fn() });

describe("транспорт", () => {
  it("сетевой сбой показывает по-русски, а не Failed to fetch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const t = createTransport({ baseUrl: "", tokenSource: source(), fetchImpl });
    await expect(t.get("/api/templates")).rejects.toThrow(OFFLINE_MESSAGE);
  });

  it("401 сбрасывает токен и просит войти заново", async () => {
    const tokenSource = source();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const t = createTransport({ baseUrl: "", tokenSource, fetchImpl });
    await expect(t.get("/api/templates")).rejects.toBeInstanceOf(AuthRequiredError);
    expect(tokenSource.clear).toHaveBeenCalled();
  });

  it("показывает текст ошибки сервера, а не код", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Такого работника нет" }), { status: 400 }),
      );
    const t = createTransport({ baseUrl: "", tokenSource: source(), fetchImpl });
    await expect(t.get("/api/x")).rejects.toThrow("Такого работника нет");
  });

  it("кладёт токен в Authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const t = createTransport({ baseUrl: "", tokenSource: source("abc"), fetchImpl });
    await t.get("/api/templates");
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe("Bearer abc");
  });
});
