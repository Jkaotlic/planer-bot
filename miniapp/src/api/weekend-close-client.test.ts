import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@telegram-apps/sdk-react", () => ({
  initDataRaw: () => "signed-init-data",
  restoreInitData: () => undefined,
  isThemeParamsDark: false,
  useSignal: () => false,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("real closeSlot client", () => {
  it("шлёт POST /api/admin/weekend/slots/:id/close и отдаёт toldOff из ответа", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/auth")) return json({ token: "test-token" });
      requests.push({ url, method });
      return json({ ok: true, toldOff: 3 });
    });

    const { realClient } = await import("./client");
    await expect(realClient.closeSlot(42)).resolves.toEqual({ toldOff: 3 });
    // Не тот путь или метод — сервер ответит 404, а экран скажет «не удалось»,
    // хотя кнопка «работает».
    expect(requests).toEqual([{ url: "/api/admin/weekend/slots/42/close", method: "POST" }]);
  });
});
