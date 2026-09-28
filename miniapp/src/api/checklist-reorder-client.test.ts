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

describe("real reorderChecklistItem client", () => {
  it("шлёт POST /api/admin/checklist/items/:id/order с {to} — тот же маршрут, что у консоли", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const checklist = { id: 5, name: "Обход", items: [] };
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth")) return json({ token: "test-token" });
      requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ checklist });
    });

    const { realClient } = await import("./client");
    await expect(realClient.reorderChecklistItem(12, 0)).resolves.toEqual(checklist);
    expect(requests).toEqual([{ url: "/api/admin/checklist/items/12/order", method: "POST", body: { to: 0 } }]);
  });
});
