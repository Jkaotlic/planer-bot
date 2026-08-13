import { describe, it, expect } from "vitest";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
import { createShift, getShift } from "../../repo/shifts";
import { getHandover, listHandoversForEntry } from "../../repo/handovers";
import { signInitData } from "../../auth/telegram";
import { teamNow } from "../../util/team-time";
import { addDaysIso } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
  handoverFanHours: 3, handoverEscalateHours: 12,
};

const initDataFor = (id: number) =>
  signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) },
    config.botToken,
  );

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

const authed = (t: string, body?: unknown, method = "POST") => ({
  method,
  headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function worker(db: Db, tgId: number, displayName: string) {
  createEmployee(db, { displayName, inviteToken: `tok-${tgId}` });
  return linkTelegramAccount(db, `tok-${tgId}`, tgId, `u${tgId}`, displayName)!;
}

const today = () => teamNow(config.teamTz).date;
const day = (offset: number) => addDaysIso(today(), offset);

describe("POST /api/my/entries — больничный рождает передачи", () => {
  it("returns a handover per shift the sick leave covers, with candidates", async () => {
    const db = makeTestDb();
    const me = worker(db, 601, "Аня");
    const igor = worker(db, 602, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 601);

    const res = await app.request(
      new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1), endDate: day(2) })),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handovers).toHaveLength(2);
    expect(body.handovers[0].shiftLine).toContain("09:00–18:00");
    expect(body.handovers[0].candidates.map((c: { id: number }) => c.id)).toContain(igor.id);
  });

  it("creates none for an event — a two-hour meeting does not free a shift", async () => {
    const db = makeTestDb();
    const me = worker(db, 611, "Аня");
    worker(db, 612, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 611);

    const res = await app.request(
      new Request(
        "http://x/api/my/entries",
        authed(token, { category: "offsite", date: day(1), start: "14:00", end: "16:00", title: "Конференция" }),
      ),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).handovers).toEqual([]);
  });
});

describe("POST /api/my/handovers/:id/offer", () => {
  async function scene() {
    const db = makeTestDb();
    const me = worker(db, 621, "Аня");
    const igor = worker(db, 622, "Игорь");
    const mark = worker(db, 623, "Марк");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 621);
    const created = await (
      await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))
    ).json();
    return { db, app, token, me, igor, mark, handoverId: created.handovers[0].id as number };
  }

  it("offers and remembers the addressee", async () => {
    const { db, app, token, igor, handoverId } = await scene();

    const res = await app.request(
      new Request(`http://x/api/my/handovers/${handoverId}/offer`, authed(token, { toEmployeeId: igor.id })),
    );

    expect(res.status).toBe(200);
    const after = getHandover(db, handoverId);
    expect(after?.status).toBe("offered");
    expect(after?.offeredToEmployeeId).toBe(igor.id);
  });

  it("refuses somebody else's handover and changes nothing", async () => {
    const { db, app, igor, mark, handoverId } = await scene();
    const igorToken = await tokenFor(app, 622);

    const res = await app.request(
      new Request(`http://x/api/my/handovers/${handoverId}/offer`, authed(igorToken, { toEmployeeId: mark.id })),
    );

    expect(res.status).toBe(404);
    expect(getHandover(db, handoverId)?.offeredToEmployeeId).toBeNull();
    expect(igor.id).toBeGreaterThan(0);
  });

  it("refuses a candidate who is busy at those hours, and the screen is not the guard", async () => {
    const { db, app, token, igor, handoverId } = await scene();
    createShift(db, { date: day(1), start: "12:00", end: "20:00", category: "shift", title: "День", employeeId: igor.id });

    const res = await app.request(
      new Request(`http://x/api/my/handovers/${handoverId}/offer`, authed(token, { toEmployeeId: igor.id })),
    );

    expect(res.status).toBe(400);
    expect(getHandover(db, handoverId)?.offeredToEmployeeId).toBeNull();
  });
});

describe("POST /api/my/handovers/:id/skip", () => {
  it("«Потом» asks everybody free instead of leaving the shift on a sick person", async () => {
    const db = makeTestDb();
    const me = worker(db, 631, "Аня");
    worker(db, 632, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 631);
    const created = await (
      await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))
    ).json();

    const res = await app.request(
      new Request(`http://x/api/my/handovers/${created.handovers[0].id}/skip`, authed(token)),
    );

    expect(res.status).toBe(200);
    expect(getHandover(db, created.handovers[0].id)?.status).toBe("fanned");
  });
});

describe("снятие и правка больничного гасят передачи", () => {
  async function sickWithTwoDays() {
    const db = makeTestDb();
    const me = worker(db, 641, "Аня");
    worker(db, 642, "Игорь");
    const first = createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const second = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 641);
    const created = await (
      await app.request(
        new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1), endDate: day(2) })),
      )
    ).json();
    return { db, app, token, me, first, second, sickId: created.entry.id as number };
  }

  it("DELETE cancels the handovers that sick leave spawned", async () => {
    const { db, app, token, sickId } = await sickWithTwoDays();
    // Id'ы берутся ДО удаления: запись отвязывается от больничного, чтобы строка
    // его пережила, и `listHandoversForEntry` после удаления вернёт пусто. Цикл
    // по пустому списку прошёл бы при любой реализации.
    const ids = listHandoversForEntry(db, sickId).map((h) => h.id);
    expect(ids).toHaveLength(2);

    const res = await app.request(new Request(`http://x/api/my/entries/${sickId}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    for (const id of ids) expect(getHandover(db, id)?.status).toBe("cancelled");
    // Отвязка — не удаление: строки остаются историей.
    for (const id of ids) expect(getHandover(db, id)?.sickEntryId).toBeNull();
  });

  it("PATCH cancels only the days the shortened sick leave no longer covers", async () => {
    const { db, app, token, first, second, sickId } = await sickWithTwoDays();

    const res = await app.request(
      new Request(`http://x/api/my/entries/${sickId}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(1) }, "PATCH")),
    );

    expect(res.status).toBe(200);
    const rows = listHandoversForEntry(db, sickId);
    expect(rows.find((h) => h.shiftId === second.id)?.status).toBe("cancelled");
    expect(rows.find((h) => h.shiftId === first.id)?.status).toBe("offered");
  });

  it("PATCH opens a handover for a day the sick leave now reaches", async () => {
    // Продление больничного — это правка той же записи, и смена нового дня
    // остаётся без человека ровно так же, как в первый день.
    const { db, app, token, me, sickId } = await sickWithTwoDays();
    const third = createShift(db, { date: day(3), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });

    await app.request(
      new Request(`http://x/api/my/entries/${sickId}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(3) }, "PATCH")),
    );

    const rows = listHandoversForEntry(db, sickId);
    expect(rows.filter((h) => h.status !== "cancelled")).toHaveLength(3);
    expect(rows.find((h) => h.shiftId === third.id)).toBeDefined();
    expect(getShift(db, third.id)?.employeeId).toBe(me.id);
  });
});
