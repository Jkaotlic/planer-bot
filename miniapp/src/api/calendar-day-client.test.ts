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

/**
 * Отметка дня в реальном клиенте мини-аппа: число оставшихся выходных смен
 * (I5 аудита 2026-10-15) обязано дойти до экрана — потеряй его клиент, и
 * предупреждение молчало бы при живом сервере.
 */
describe("real setCalendarDay client", () => {
  async function markWith(body: unknown) {
    vi.stubGlobal("fetch", async (input: string | URL | Request) =>
      String(input).endsWith("/api/auth") ? json({ token: "test-token" }) : json(body),
    );
    const { realClient } = await import("./client");
    return realClient;
  }

  it("отдаёт день и число оставшихся выходных смен", async () => {
    const client = await markWith({ date: "2026-10-17", kind: "workday", note: null, source: "manual", weekendLeftovers: 2 });
    await expect(client.setCalendarDay("2026-10-17", "workday")).resolves.toEqual({
      day: { date: "2026-10-17", kind: "workday", note: null, source: "manual" },
      weekendLeftovers: 2,
    });
  });

  it("снятая отметка без строки — day: null", async () => {
    const client = await markWith({ date: "2026-10-14", kind: null, note: null, source: null, weekendLeftovers: 0 });
    await expect(client.setCalendarDay("2026-10-14", null)).resolves.toEqual({ day: null, weekendLeftovers: 0 });
  });
});
