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

describe("real team schedule client", () => {
  it("loads roster and shifts with one authenticated GET and joins employee names", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });

      if (url.endsWith("/api/auth")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/team/schedule?")) {
        return new Response(JSON.stringify({
          employees: [
            { id: 7, displayName: "Анна Тестова", rosterOrder: 0 },
          ],
          shifts: [
            {
              id: 41,
              date: "2026-07-27",
              start: "09:00",
              end: "18:00",
              endDate: null,
              category: "shift",
              title: "День",
              location: null,
              templateId: 2,
              employeeId: 7,
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const { realClient } = await import("./client");
    const schedule = await realClient.getTeamSchedule("2026-07-27", "2026-08-02");

    expect(schedule.shifts[0]?.employeeName).toBe("Анна Тестова");
    expect(requests.filter((request) => request.method === "GET")).toEqual([
      {
        url: "/api/team/schedule?from=2026-07-27&to=2026-08-02",
        method: "GET",
      },
    ]);
    expect(requests.some((request) => request.url.includes("/api/employees"))).toBe(false);
  });
});
