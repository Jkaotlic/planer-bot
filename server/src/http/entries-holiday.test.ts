import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { setManualDay } from "../repo/calendar-days";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/**
 * «Работа в выходной» и расстановка отрезком после календаря праздников.
 *
 * До 2026-09-04 выходным считались только суббота и воскресенье: на 12 июня
 * работу в выходной поставить было нельзя, а перенесённая рабочая суббота
 * считалась выходным. Обе половины правила проверяются здесь.
 */
const config = testConfig();
// 2026-06-11 — четверг, 12-е — пятница (День России), 13-е — суббота, 14-е — воскресенье.
const HOLIDAY = "2026-06-12";
const WORKING_SATURDAY = "2026-06-13";

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

function stage(): { db: Db; worker: number } {
  const db = makeTestDb();
  createEmployee(db, { displayName: "Аня", inviteToken: "inv-111" });
  linkTelegramAccount(db, "inv-111", 111);
  const worker = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
  setManualDay(db, HOLIDAY, "holiday", "День России", new Date());
  setManualDay(db, WORKING_SATURDAY, "workday", null, new Date());
  return { db, worker: worker.id };
}

describe("работа в выходной и календарь праздников", () => {
  it("встаёт на праздник и не встаёт на рабочую субботу", async () => {
    const { db, worker } = stage();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const body = (date: string) => ({ date, category: "weekend_work", start: "10:00", end: "18:00", employeeId: worker });

    const onHoliday = await app.request("/api/admin/entries", send(token, body(HOLIDAY), "POST"));
    expect(onHoliday.status).toBe(201);

    const onWorkingSaturday = await app.request("/api/admin/entries", send(token, body(WORKING_SATURDAY), "POST"));
    expect(onWorkingSaturday.status).toBe(400);
    expect(JSON.stringify(await onWorkingSaturday.json())).toContain("выходной или праздник");
  });

  it("правка записи судит по тому же календарю", async () => {
    const { db, worker } = stage();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const created = await (
      await app.request("/api/admin/entries", send(token, { date: HOLIDAY, category: "weekend_work", start: "10:00", end: "18:00", employeeId: worker }, "POST"))
    ).json();

    const moved = await app.request(`/api/admin/entries/${created.entry.id}`, send(token, { date: WORKING_SATURDAY }, "PATCH"));
    expect(moved.status).toBe(400);
    expect(JSON.stringify(await moved.json())).toContain("выходной или праздник");
  });

  it("bulk отвергает пачку, в которой хоть одна запись села не на тот день", async () => {
    const { db, worker } = stage();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const entry = (date: string) => ({ date, category: "weekend_work", start: "10:00", end: "18:00", employeeId: worker });

    const res = await app.request("/api/admin/entries/bulk", send(token, { entries: [entry(HOLIDAY), entry(WORKING_SATURDAY)] }, "POST"));
    expect(res.status).toBe(400);

    const ok = await app.request("/api/admin/entries/bulk", send(token, { entries: [entry(HOLIDAY)] }, "POST"));
    expect(ok.status).toBe(201);
  });

  it("расстановка отрезком пропускает праздник и берёт рабочую субботу", async () => {
    const { db, worker } = stage();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    const res = await app.request(
      "/api/admin/entries/range",
      send(token, { from: "2026-06-11", to: "2026-06-14", category: "shift", start: "09:00", end: "18:00", employeeId: worker }, "POST"),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created.map((e: { date: string }) => e.date)).toEqual(["2026-06-11", WORKING_SATURDAY]);
  });
});
