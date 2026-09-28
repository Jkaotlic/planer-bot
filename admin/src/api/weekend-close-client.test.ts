// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { realClient } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("real closeSlot client (консоль)", () => {
  it("шлёт POST /api/admin/weekend/slots/:id/close и отдаёт toldOff из ответа", async () => {
    // Токен в хранилище, иначе клиент упрётся в отсутствие initData раньше сети.
    window.localStorage.setItem("adminToken", "token-for-the-test");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, toldOff: 3 }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(realClient.closeSlot(42)).resolves.toEqual({ toldOff: 3 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("/api/admin/weekend/slots/42/close");
    expect(init?.method).toBe("POST");
  });
});
