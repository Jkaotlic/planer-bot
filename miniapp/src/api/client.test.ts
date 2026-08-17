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

describe("real notice prefs client", () => {
  it("reads GET /api/me/notifications and writes PATCH with {kind, enabled}", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });

      if (url.endsWith("/api/auth")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/me/notifications") && method === "GET") {
        return new Response(
          JSON.stringify({
            kinds: [{ kind: "swaps", title: "Обмены сменами", hint: "Кто с кем поменялся сменами.", enabled: true }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/me/notifications") && method === "PATCH") {
        return new Response(JSON.stringify({ kind: "swaps", enabled: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const { realClient } = await import("./client");

    const prefs = await realClient.getNoticePrefs();
    expect(prefs.kinds).toEqual([
      { kind: "swaps", title: "Обмены сменами", hint: "Кто с кем поменялся сменами.", enabled: true },
    ]);

    const saved = await realClient.setNoticePref("swaps", false);
    expect(saved).toEqual({ kind: "swaps", enabled: false });

    // Метод, путь и тело — перепутать любой из трёх значило бы молча выключить
    // не тот вид письма или вовсе не дойти до сервера.
    expect(requests.filter((request) => request.url.endsWith("/api/me/notifications"))).toEqual([
      { url: "/api/me/notifications", method: "GET", body: undefined },
      { url: "/api/me/notifications", method: "PATCH", body: { kind: "swaps", enabled: false } },
    ]);
  });
});

describe("real announcements client", () => {
  it("posts {text, audience} to /api/admin/announcements and hands back the server's report unchanged", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });

      if (url.endsWith("/api/auth")) {
        return new Response(JSON.stringify({ token: "test-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/admin/announcements") && method === "POST") {
        return new Response(
          JSON.stringify({ delivered: 2, intended: 3, unreachable: ["Марк Волков"] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const { realClient } = await import("./client");
    const result = await realClient.sendAnnouncement("Завтра собрание в 10:00", [2, 3, 4]);

    expect(result).toEqual({ delivered: 2, intended: 3, unreachable: ["Марк Волков"] });
    expect(requests.filter((request) => request.url.endsWith("/api/admin/announcements"))).toEqual([
      {
        url: "/api/admin/announcements",
        method: "POST",
        body: { text: "Завтра собрание в 10:00", audience: [2, 3, 4] },
      },
    ]);
  });
});
