import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
import { createShift, listShiftsInRange } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { NOTICE_WINDOW_MS } from "../schedule/notice-buffer";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * «Расставить с какого по какое» (его пункт 6 от 2026-08-21).
 *
 * The point of the route is that a range of work is N one-day entries, not one
 * row carrying `endDate`: `entryDateError` forbids the latter on purpose,
 * because a shift with a span draws into every day of it while the balance and
 * the report count it once.
 */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

// 2026-08-24 — понедельник; 29-е и 30-е — суббота и воскресенье.
const MON = "2026-08-24";
const SUN = "2026-08-30";

describe("POST /api/admin/entries/range", () => {
  it("создаёт по записи на каждый будний день, а не одну с endDate", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00", title: "День",
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(5);
    expect(body.skipped.map((s: { reason: string }) => s.reason)).toEqual(["weekend", "weekend"]);

    const rows = listShiftsInRange(db, MON, SUN);
    expect(rows).toHaveLength(5);
    // Ни одна не диапазонная — иначе баланс считал бы одну смену вместо пяти.
    expect(rows.every((r) => r.endDate === null)).toBe(true);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
    ]);
  });

  it("с поднятым флагом берёт и выходные", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
      includeWeekends: true,
    }));
    expect(listShiftsInRange(db, MON, SUN)).toHaveLength(7);
  });

  it("занятый день пропускает, а не кладёт вторую смену поверх первой", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-08-25", start: "09:00", end: "18:00", employeeId: anya.id, category: "shift" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: "2026-08-26", category: "shift", start: "08:00", end: "17:00",
    }))).json();

    expect(body.created).toHaveLength(2);
    expect(body.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
    // Прежняя запись не тронута: 09:00, а не 08:00.
    expect(listShiftsInRange(db, "2026-08-25", "2026-08-25")[0]!.start).toBe("09:00");
  });

  // Отсутствие в базе живёт полосой, а не набором клеток: тридцать строк вместо
  // одной сломали бы и сетку, и журнал.
  it("отпуск пишет одной записью с endDate", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "vacation",
    }))).json();

    expect(body.created).toHaveLength(1);
    expect(body.created[0]).toMatchObject({ date: MON, endDate: SUN, category: "vacation", start: null, end: null });
  });

  it("«Работа в выходной» берёт только субботу и воскресенье", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const body = await (await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "weekend_work", start: "10:00", end: "16:00",
      includeWeekends: true,
    }))).json();

    expect(body.created.map((e: { date: string }) => e.date)).toEqual(["2026-08-29", "2026-08-30"]);
  });

  // Тридцать `entry_created` подряд сделали бы журнал и ленту нечитаемыми.
  it("оставляет в журнале одну строку на всю расстановку", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00", title: "День",
    }));

    const events = listRecentAudit(db, 20);
    expect(events.map((e) => e.type)).toEqual(["entries_range_created"]);
    expect(events[0]!.payload).toMatchObject({ employeeName: "Аня", from: MON, to: SUN, created: 5, skipped: 2 });
  });

  // Ради этого noticeBuffer и написан: пять писем за 24 секунды — тот самый
  // инцидент, из которого он вырос.
  it("шлёт работнику одно письмо на всю расстановку, а не по письму на день", async () => {
    vi.useFakeTimers();
    try {
      const db = makeTestDb();
      const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-anya" });
      linkTelegramAccount(db, "inv-anya", 555);
      const { bot, sent } = fakeBot();
      const app = createApp({ db, config, bot });
      const admin = await tokenFor(app, 111);

      await app.request("/api/admin/entries/range", authedJson(admin, {
        employeeId: anya.id, from: "2099-01-05", to: "2099-01-09", category: "shift", start: "09:00", end: "18:00",
      }));

      await vi.advanceTimersByTimeAsync(NOTICE_WINDOW_MS + 100);
      expect(sent.filter((m) => m.to === 555)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("отказывает на диапазоне длиннее года", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: "2026-01-01", to: "2027-06-01", category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, "2026-01-01", "2027-06-01")).toHaveLength(0);
  });

  it("отказывает на архивном работнике и ничего не создаёт", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    archiveEmployee(db, anya.id, MON);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request("/api/admin/entries/range", authedJson(admin, {
      employeeId: anya.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, MON, SUN)).toHaveLength(0);
  });

  it("не пускает не-админа", async () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const app = createApp({ db, config });
    const worker = await tokenFor(app, 333);

    const res = await app.request("/api/admin/entries/range", authedJson(worker, {
      employeeId: igor.id, from: MON, to: SUN, category: "shift", start: "09:00", end: "18:00",
    }));
    expect(res.status).toBe(403);
  });
});
