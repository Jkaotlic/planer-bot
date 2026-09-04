import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { listCalendarYear, setManualDay } from "../repo/calendar-days";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { FetchOutcome, FetchYear } from "../holidays/xmlcalendar";
import type { Db } from "../db/client";

/**
 * Управление календарём праздников: рычаг, кнопка «Обновить сейчас» и ручная
 * отметка дня. Загрузчик подменяется, чтобы тест не ходил в сеть.
 */
const config = testConfig();
const XML = `<calendar year="2026"><holidays><holiday id="7" title="День России"/></holidays><days><day d="06.12" t="1" h="7"/></days></calendar>`;

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (
    await (
      await app.request(
        new Request("http://x/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: initDataFor(id) }),
        }),
      )
    ).json()
  ).token as string;
const send = (token: string, body: unknown, method: string) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function fetcher(map: Record<number, FetchOutcome>): FetchYear {
  return async (year) => map[year] ?? { status: "missing" };
}

function stage(fetchHolidays?: FetchYear): { db: Db; app: ReturnType<typeof createApp>; workerTg: number } {
  const db = makeTestDb();
  const admin = createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  setEmployeeAdmin(db, admin.id, true);
  const worker = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  linkTelegramAccount(db, "inv-333", 333);
  void worker;
  return { db, app: createApp({ db, config, fetchHolidays }), workerTg: 333 };
}

describe("GET /api/admin/settings — праздники", () => {
  it("на пустой базе автозагрузка включена, загруженных лет нет", async () => {
    const { app } = stage();
    const res = await app.request("/api/admin/settings", auth(await tokenFor(app, 111)));
    const body = await res.json();
    expect(body.holidaysAuto).toBe(true);
    expect(body.holidays).toEqual([]);
  });
});

describe("PUT /api/admin/settings/holidays-auto", () => {
  it("выключает рычаг, пишет в журнал и отдаётся обратно в настройках", async () => {
    const { db, app } = stage();
    const token = await tokenFor(app, 111);

    const res = await app.request("/api/admin/settings/holidays-auto", send(token, { enabled: false }, "PUT"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });

    expect((await (await app.request("/api/admin/settings", auth(token))).json()).holidaysAuto).toBe(false);
    expect(listRecentAudit(db, 5)[0]).toMatchObject({ type: "holidays_auto_changed" });
  });

  it("не булево — 400", async () => {
    const { app } = stage();
    const res = await app.request("/api/admin/settings/holidays-auto", send(await tokenFor(app, 111), { enabled: "нет" }, "PUT"));
    expect(res.status).toBe(400);
  });

  it("работнику нельзя", async () => {
    const { app, workerTg } = stage();
    const res = await app.request("/api/admin/settings/holidays-auto", send(await tokenFor(app, workerTg), { enabled: false }, "PUT"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/holidays/refresh", () => {
  it("загружает год и отчитывается по каждому", async () => {
    const { db, app } = stage(fetcher({ 2026: { status: "ok", xml: XML } }));

    const res = await app.request("/api/admin/holidays/refresh?asOf=2026-09-04", send(await tokenFor(app, 111), {}, "POST"));

    expect(res.status).toBe(200);
    const { years } = await res.json();
    expect(years).toEqual([
      { year: 2026, status: "ok", added: 1, removed: 0 },
      { year: 2027, status: "missing", added: 0, removed: 0 },
    ]);
    expect(listCalendarYear(db, 2026).map((d) => d.date)).toEqual(["2026-06-12"]);
  });

  it("работнику нельзя", async () => {
    const { app, workerTg } = stage(fetcher({ 2026: { status: "ok", xml: XML } }));
    const res = await app.request("/api/admin/holidays/refresh", send(await tokenFor(app, workerTg), {}, "POST"));
    expect(res.status).toBe(403);
  });

  it("две одновременные загрузки — вторая получает 409, а не второй поход в сеть", async () => {
    let calls = 0;
    const slow: FetchYear = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: "ok", xml: XML };
    };
    const { app } = stage(slow);
    const token = await tokenFor(app, 111);

    const [first, second] = await Promise.all([
      app.request("/api/admin/holidays/refresh?asOf=2026-09-04", send(token, {}, "POST")),
      app.request("/api/admin/holidays/refresh?asOf=2026-09-04", send(token, {}, "POST")),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    // Один заход в сеть на год: 2026 и 2027 первой загрузкой, и ничего второй.
    expect(calls).toBe(2);
  });
});

describe("PUT /api/admin/calendar/:date", () => {
  it("ставит выходной руками и снимает отметку", async () => {
    const { db, app } = stage();
    const token = await tokenFor(app, 111);

    const set = await app.request("/api/admin/calendar/2026-12-31", send(token, { kind: "holiday", note: "Работаем до обеда" }, "PUT"));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ date: "2026-12-31", kind: "holiday", note: "Работаем до обеда", source: "manual" });
    expect(listRecentAudit(db, 5)[0]).toMatchObject({ type: "calendar_day_set" });

    const cleared = await app.request("/api/admin/calendar/2026-12-31", send(token, { kind: null }, "PUT"));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ date: "2026-12-31", kind: null, note: null, source: null });
    expect(listCalendarYear(db, 2026)).toHaveLength(0);
  });

  it("перекрывает автоматическую строку, а не удаляет её вид", async () => {
    const { db, app } = stage();
    setManualDay(db, "2026-06-12", "holiday", "День России", new Date());

    await app.request("/api/admin/calendar/2026-06-12", send(await tokenFor(app, 111), { kind: "workday" }, "PUT"));

    expect(listCalendarYear(db, 2026)[0]).toMatchObject({ kind: "workday", source: "manual" });
  });

  it("непонятная дата или вид — 400", async () => {
    const { app } = stage();
    const token = await tokenFor(app, 111);
    expect((await app.request("/api/admin/calendar/2026-13-01", send(token, { kind: "holiday" }, "PUT"))).status).toBe(400);
    expect((await app.request("/api/admin/calendar/2026-06-12", send(token, { kind: "выходной" }, "PUT"))).status).toBe(400);
  });

  it("работнику нельзя", async () => {
    const { app, workerTg } = stage();
    const res = await app.request("/api/admin/calendar/2026-06-12", send(await tokenFor(app, workerTg), { kind: "holiday" }, "PUT"));
    expect(res.status).toBe(403);
  });
});
