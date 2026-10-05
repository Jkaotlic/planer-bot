import { describe, it, expect } from "vitest";
import { startHandovers } from "../../handover/handover-service";
import { createHandoverMessenger } from "../../handover/handover-messenger";
import { approveSickLeave, sickApprovalDeps } from "../../sick-approval/sick-approval-service";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../../repo/employees";
import { createShift, getShift, updateShift } from "../../repo/shifts";
import { createHandover, getHandover, listHandoversForEntry } from "../../repo/handovers";
import { signInitData } from "../../auth/telegram";
import { teamNow } from "../../util/team-time";
import { addDaysIso } from "@planer/shared";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";

const config = testConfig({ adminTelegramIds: [] });

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
    worker(db, 602, "Игорь");
    const boss = worker(db, 603, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 601);

    const res = await app.request(
      new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1), endDate: day(2) })),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    // A worker's booking only asks for the «ОК»: nothing is handed over until an admin agrees.
    expect(body.pending).toBe(true);
    expect(body.handovers).toEqual([]);
    expect(listHandoversForEntry(db, body.entry.id)).toHaveLength(0);

    await approveSickLeave(sickApprovalDeps(null, db, config), body.entry.id, boss.id);

    const made = listHandoversForEntry(db, body.entry.id);
    expect(made).toHaveLength(2);
  });

  it("an admin's own sick leave is approved at once and returns the drafts to the form, with candidates", async () => {
    const db = makeTestDb();
    const me = worker(db, 604, "Аня");
    setEmployeeAdmin(db, me.id, true);
    const igor = worker(db, 605, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 604);

    const body = await (
      await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))
    ).json();

    expect(body.pending).toBe(false);
    expect(body.handovers).toHaveLength(1);
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
    // An admin's own sick leave is approved at once — the path that still returns hand-over drafts to the form.
    setEmployeeAdmin(db, me.id, true);
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
    // An admin's own sick leave is approved at once — the path that still returns hand-over drafts to the form.
    setEmployeeAdmin(db, me.id, true);
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
    // An admin's own sick leave is approved at once — the path that still creates hand-overs (and lets PATCH extend without a new «ОК»).
    setEmployeeAdmin(db, me.id, true);
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

describe("GET /api/my/handovers/drafts", () => {
  it("returns my undecided drafts after an admin's «ОК», and drops one once it is offered", async () => {
    const db = makeTestDb();
    const me = worker(db, 631, "Аня");
    const igor = worker(db, 632, "Игорь");
    const boss = worker(db, 633, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 631);
    const created = await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))).json();
    expect((await (await app.request(new Request("http://x/api/my/handovers/drafts", authed(token, undefined, "GET")))).json()).drafts).toEqual([]);

    await approveSickLeave(sickApprovalDeps(null, db, config), created.entry.id, boss.id);
    const { drafts } = await (await app.request(new Request("http://x/api/my/handovers/drafts", authed(token, undefined, "GET")))).json();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].shiftLine).toContain("09:00–18:00");
    expect(drafts[0].candidates.map((c: { id: number }) => c.id)).toContain(igor.id);

    await app.request(new Request(`http://x/api/my/handovers/${drafts[0].id}/offer`, authed(token, { toEmployeeId: igor.id })));
    expect((await (await app.request(new Request("http://x/api/my/handovers/drafts", authed(token, undefined, "GET")))).json()).drafts).toEqual([]);
  });

  it("a colleague's drafts are not mine to see", async () => {
    const db = makeTestDb();
    const me = worker(db, 641, "Аня");
    worker(db, 642, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const sick = createShift(db, { date: day(1), category: "sick_leave", employeeId: me.id });
    await startHandovers({ db, config, messenger: createHandoverMessenger(null, db) }, { sickEntry: sick, employeeId: me.id });
    const app = createApp({ db, config, bot: undefined });
    const igorToken = await tokenFor(app, 642);
    expect((await (await app.request(new Request("http://x/api/my/handovers/drafts", authed(igorToken, undefined, "GET")))).json()).drafts).toEqual([]);
  });
});

describe("GET /api/my/handovers/drafts — which drafts are shown", () => {
  /** Аня with an approved sick leave over today..day(30) (so a shift today is covered, not void); drafts are written by hand to control each shift. */
  function sceneWithSick() {
    const db = makeTestDb();
    const me = worker(db, 651, "Аня");
    const igor = worker(db, 652, "Игорь");
    const sick = createShift(db, { date: today(), endDate: day(30), category: "sick_leave", employeeId: me.id });
    const draft = (shiftId: number) =>
      createHandover(db, { shiftId, fromEmployeeId: me.id, sickEntryId: sick.id, status: "offered", offeredToEmployeeId: null });
    const app = createApp({ db, config, bot: undefined });
    const list = async () => {
      const token = await tokenFor(app, 651);
      return (await (await app.request(new Request("http://x/api/my/handovers/drafts", authed(token, undefined, "GET")))).json()).drafts as { id: number }[];
    };
    return { db, me, igor, sick, draft, list };
  }

  it("leaves out a shift that has already started — offering it would be refused anyway", async () => {
    const { db, me, draft, list } = sceneWithSick();
    // Today, 00:00: started for sure, yet its date passes the «today or later» database filter.
    const started = createShift(db, { date: today(), start: "00:00", end: "23:59", category: "shift", title: "День", employeeId: me.id });
    const future = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    draft(started.id);
    const futureDraft = draft(future.id);
    // Wrong implementation caught: no «already started» check.
    expect((await list()).map((d) => d.id)).toEqual([futureDraft.id]);
  });

  it("leaves out a void draft (shift handed to somebody else)", async () => {
    const { db, me, igor, draft, list } = sceneWithSick();
    const given = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    const kept = createShift(db, { date: day(3), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: me.id });
    draft(given.id);
    const keptDraft = draft(kept.id);
    updateShift(db, given.id, { employeeId: igor.id });
    // Wrong implementation caught: no void check — the draft would be offered for a shift Аня no longer owns.
    expect((await list()).map((d) => d.id)).toEqual([keptDraft.id]);
  });

  it("filters before capping: 21 void drafts ahead of a live one do not hide it", async () => {
    const { db, me, igor, draft, list } = sceneWithSick();
    for (let i = 0; i < 21; i += 1) {
      const gone = createShift(db, { date: day(2 + (i % 5)), start: "09:00", end: "18:00", category: "shift", title: `Д${i}`, employeeId: me.id });
      draft(gone.id);
      updateShift(db, gone.id, { employeeId: igor.id });
    }
    const live = createShift(db, { date: day(20), start: "09:00", end: "18:00", category: "shift", title: "Живая", employeeId: me.id });
    const liveDraft = draft(live.id);
    // Wrong implementation caught: `limit 20` before the void filter returns an empty list here.
    expect((await list()).map((d) => d.id)).toEqual([liveDraft.id]);
  });
});
