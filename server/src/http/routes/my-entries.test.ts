import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import {
  createEmployee,
  linkTelegramAccount,
  setEmployeeAdmin,
  setEmployeeObserver,
  setSelfScheduleEnabled,
} from "../../repo/employees";
import { createShift, getShift, listShiftsInRange } from "../../repo/shifts";
import { listRecentAudit } from "../../repo/audit";
import { listHandoversForEntry, getHandover } from "../../repo/handovers";
import { setNoticeMuted } from "../../repo/notice-prefs";
import { signInitData } from "../../auth/telegram";
import { teamNow } from "../../util/team-time";
import { addDaysIso } from "@planer/shared";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";
import { cancelHandoversForEntry, detachHandoversFromEntry, startHandovers } from "../../handover/handover-service";
import { approveSickLeave, sickApprovalDeps } from "../../sick-approval/sick-approval-service";

/**
 * Спай, а не мок: реализация — настоящая (`importOriginal`), подменяются
 * только сами функции-обёртки. Нужен ровно для одного вопроса — «эту функцию
 * вообще позвали?» — который проверка по итогу в базе не может задать
 * напрямую: у наблюдателя список смен для передачи и так пуст без своей
 * смены на дату, и тест на пустой результат не отличил бы работающий гейт от
 * отсутствующего (см. находку про POST-тест выше). Для PATCH и DELETE
 * заводить наблюдателю вторую смену ради того же трюка не обязательно — спай
 * ловит сам факт вызова, не его последствия.
 */
vi.mock("../../handover/handover-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../handover/handover-service")>();
  return {
    ...actual,
    cancelHandoversForEntry: vi.fn(actual.cancelHandoversForEntry),
    detachHandoversFromEntry: vi.fn(actual.detachHandoversFromEntry),
    startHandovers: vi.fn(actual.startHandovers),
  };
});

/**
 * A bot that records what it was asked to send instead of talking to Telegram. It hands
 * back a `message_id` and can edit: without both the approval service cannot remember its
 * letters, and the «redraw / finish» paths would silently have nothing to act on.
 */
function fakeBot() {
  const sent: { to: number; text: string; extra?: { reply_markup?: unknown } }[] = [];
  const edits: { chat: number; message: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string, extra?: { reply_markup?: unknown }) => {
        sent.push({ to, text, extra });
        return { message_id: sent.length };
      }),
      editMessageText: vi.fn(async (chat: number, message: number, text: string) => {
        edits.push({ chat, message, text });
        return true;
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent, edits };
}

const config = testConfig({ adminTelegramIds: [] });

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;

const authed = (t: string, body?: unknown, method = "POST") => ({
  method,
  headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** A linked worker whose Telegram id equals their row id offset, for readability. */
function worker(db: Db, tgId: number, displayName: string) {
  createEmployee(db, { displayName, inviteToken: `tok-${tgId}` });
  return linkTelegramAccount(db, `tok-${tgId}`, tgId, `u${tgId}`, displayName)!;
}

/** Наблюдатель с телеграмом — как `worker`, но с ролью. */
function observerWorker(db: Db, tgId: number, displayName: string, ownShifts: boolean) {
  const person = worker(db, tgId, displayName);
  setEmployeeObserver(db, person.id, true);
  if (ownShifts) setSelfScheduleEnabled(db, person.id, true);
  return person;
}

/** Team dates, never the machine's — the day boundary must not depend on the runner. */
const today = () => teamNow(config.teamTz).date;
const day = (offset: number) => addDaysIso(today(), offset);

describe("POST /api/my/entries", () => {
  it("refuses a category the worker does not own, and writes nothing", async () => {
    const db = makeTestDb();
    const me = worker(db, 501, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 501);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", title: "День",
    })));

    expect(res.status).toBe(400);
    // The refusal has to be a refusal, not a 400 shouted after the row landed.
    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("records the entry on the CALLER, whatever employeeId the body carries", async () => {
    const db = makeTestDb();
    const me = worker(db, 502, "Аня");
    const other = worker(db, 503, "Игорь");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 502);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(0), endDate: day(1), employeeId: other.id,
    })));

    expect(res.status).toBe(201);
    const rows = listShiftsInRange(db, day(0), day(0));
    expect(rows.filter((s) => s.employeeId === me.id)).toHaveLength(1);
    expect(rows.filter((s) => s.employeeId === other.id)).toHaveLength(0);
  });

  it("refuses a sick leave older than the backdating window, and writes nothing", async () => {
    const db = makeTestDb();
    const me = worker(db, 504, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 504);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(-8), endDate: day(-8),
    })));

    expect(res.status).toBe(400);
    expect(listShiftsInRange(db, day(-8), day(-8)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("refuses an event without an end — a timed entry with no hours is a second-class row", async () => {
    const db = makeTestDb();
    worker(db, 505, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 505);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "offsite", date: day(1), start: "14:00", title: "Конференция",
    })));

    expect(res.status).toBe(400);
  });

  it("journals it as a self entry, not as an admin one", async () => {
    const db = makeTestDb();
    worker(db, 506, "Аня");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 506);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "offsite", date: day(2), start: "14:00", end: "16:00", title: "Конференция", location: "Поклонка",
    })));

    const types = listRecentAudit(db, 10).map((row) => row.type);
    expect(types).toContain("self_entry_created");
    expect(types).not.toContain("entry_created");
  });

  it("tells the admins, naming the shift the sick leave just left uncovered", async () => {
    const db = makeTestDb();
    const me = worker(db, 507, "Аня");
    const boss = worker(db, 508, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    createShift(db, { employeeId: me.id, date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День" });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 507);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1), endDate: day(2),
    })));

    expect(sent.map((m) => m.to)).toEqual([508]);
    // The letter is now the approval request, not the old notice.
    expect(sent[0]!.text).toContain("🤒");
    expect(sent[0]!.text).toContain("Аня");
    expect(sent[0]!.text).toContain("09:00–18:00");
    // Header, one day line, tail. The second day holds nothing, so it must not add a line about nothing.
    expect(sent[0]!.text.split("\n")).toHaveLength(3);
  });
});

describe("больничный работника ждёт ОК", () => {
  function admins(db: Db) {
    const igor = worker(db, 701, "Игорь");
    setEmployeeAdmin(db, igor.id, true);
    return igor;
  }

  it("POST: entry is pending, no hand-over, and admins get ONE letter — the request", async () => {
    const db = makeTestDb();
    const me = worker(db, 702, "Аня");
    admins(db);
    worker(db, 703, "Олег");
    createShift(db, { employeeId: me.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 702);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pending).toBe(true);
    expect(body.handovers).toEqual([]);
    expect(getShift(db, body.entry.id)!.approvalRequestedAt).not.toBeNull();
    expect(listHandoversForEntry(db, body.entry.id)).toHaveLength(0);
    const toAdmin = sent.filter((m) => m.to === 701);
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0]!.text.startsWith("🤒 Аня — больничный")).toBe(true);
    expect(toAdmin[0]!.text).toContain("08:00–17:00");
  });

  it("POST by an admin: approved at once — no «ОК» to oneself — and the hand-over starts as before", async () => {
    const db = makeTestDb();
    const boss = admins(db);
    worker(db, 704, "Олег");
    createShift(db, { employeeId: boss.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 701);

    const body = await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))).json();

    expect(body.pending).toBe(false);
    expect(getShift(db, body.entry.id)!.approvalRequestedAt).toBeNull();
    expect(body.handovers).toHaveLength(1);
  });

  it("POST by an observer: also waits for an «ОК» (spec item 4)", async () => {
    const db = makeTestDb();
    observerWorker(db, 705, "Даша", false);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 705);
    const body = await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))).json();
    expect(body.pending).toBe(true);
  });

  it("PATCH of a pending one (shortened): stays pending, starts nothing, redraws the letter instead of a second one", async () => {
    const db = makeTestDb();
    worker(db, 706, "Аня");
    admins(db);
    const { bot, sent, edits } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 706);
    const id = (await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1), endDate: day(3) })))).json()).entry.id;
    const sentBefore = sent.length;
    const startBefore = vi.mocked(startHandovers).mock.calls.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(1) }, "PATCH")));

    expect(res.status).toBe(200);
    expect(getShift(db, id)!.approvalRequestedAt).not.toBeNull();
    expect(vi.mocked(startHandovers).mock.calls.length).toBe(startBefore);
    expect(sent.length).toBe(sentBefore);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.text.startsWith("🤒 Аня — больничный")).toBe(true);
  });

  it("PATCH extending an approved one: asks again, old days keep their hand-over, the new day waits", async () => {
    const db = makeTestDb();
    const me = worker(db, 707, "Аня");
    admins(db);
    worker(db, 708, "Олег");
    createShift(db, { employeeId: me.id, date: day(1), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    const newDay = createShift(db, { employeeId: me.id, date: day(2), start: "08:00", end: "17:00", category: "shift", title: "Утро" });
    // Approved: written the way an old row or an admin's entry is — all approval columns NULL.
    const sick = createShift(db, { employeeId: me.id, date: day(1), endDate: day(1), category: "sick_leave" });
    await startHandovers({ db, config, messenger: { offer: async () => {}, fan: async () => {}, plain: async () => {}, admins: async () => {}, adminsAlways: async () => ({ attempted: 0, delivered: 0 }) } }, { sickEntry: sick, employeeId: me.id });
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 707);

    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(2) }, "PATCH")));

    const asked = getShift(db, sick.id)!;
    expect(asked.approvalRequestedAt).not.toBeNull();
    // The approved span is remembered, so a «Отклонить» can give it back and the grid keeps it solid.
    expect([asked.approvedDate, asked.approvedEndDate]).toEqual([day(1), day(1)]);
    const live = listHandoversForEntry(db, sick.id).filter((h) => h.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live.map((h) => h.shiftId)).not.toContain(newDay.id);
    expect(sent.filter((m) => m.to === 701).map((m) => m.text.slice(0, 2))).toEqual(["🤒"]);
  });

  it("PATCH shortening an approved one needs no «ОК»", async () => {
    const db = makeTestDb();
    const me = worker(db, 709, "Аня");
    const sick = createShift(db, { employeeId: me.id, date: day(1), endDate: day(3), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 709);
    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(2) }, "PATCH")));
    expect(getShift(db, sick.id)!.approvalRequestedAt).toBeNull();
  });

  it("PATCH extending a PENDING one: still one letter, redrawn in place — never a second one", async () => {
    const db = makeTestDb();
    worker(db, 711, "Аня");
    admins(db);
    const { bot, sent, edits } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 711);
    const id = (await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))).json()).entry.id;
    const sentBefore = sent.length;

    await app.request(new Request(`http://x/api/my/entries/${id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(3) }, "PATCH")));

    // Wrong implementation caught: checking «extended» before «still pending» sends a second letter.
    expect(sent.length).toBe(sentBefore);
    expect(edits).toHaveLength(1);
    expect(getShift(db, id)!.approvedDate).toBeNull();
  });

  it("PATCH of a pending EXTENSION back inside the approved span withdraws it: approved row, buttons closed", async () => {
    const db = makeTestDb();
    const me = worker(db, 712, "Аня");
    admins(db);
    const { bot, edits } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 712);
    const sick = createShift(db, { employeeId: me.id, date: day(1), endDate: day(2), category: "sick_leave" });
    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(3) }, "PATCH")));
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();

    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, { category: "sick_leave", date: day(1), endDate: day(2) }, "PATCH")));

    // Wrong implementation caught: redrawing a letter whose request has nothing left to ask.
    const row = getShift(db, sick.id)!;
    expect([row.approvalRequestedAt, row.approvedDate]).toEqual([null, null]);
    expect(edits.at(-1)!.text.endsWith("↩️ Продление снято — ОК не нужен")).toBe(true);
  });

  it("DELETE of a pending one: every admin's buttons say «Больничного уже нет», no second letter", async () => {
    const db = makeTestDb();
    worker(db, 710, "Аня");
    admins(db);
    const { bot, sent, edits } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 710);
    const id = (await (await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })))).json()).entry.id;
    const sentBefore = sent.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    expect(edits.map((e) => e.text.split("\n\n").at(-1))).toEqual(["🗑 Больничного уже нет — Аня снял(а) сам(а)"]);
    expect(sent.length).toBe(sentBefore);
  });
});

describe("PATCH /api/my/entries/:id", () => {
  it("answers 404 for somebody else's entry and leaves it alone", async () => {
    const db = makeTestDb();
    worker(db, 511, "Аня");
    const other = worker(db, 512, "Игорь");
    const theirs = createShift(db, { employeeId: other.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 511);

    const res = await app.request(new Request(`http://x/api/my/entries/${theirs.id}`, authed(token, {
      category: "sick_leave", date: day(5), endDate: day(9),
    }, "PATCH")));

    expect(res.status).toBe(404);
    expect(getShift(db, theirs.id)!.date).toBe(day(1));
  });

  it("refuses to touch an entry that has already ended", async () => {
    const db = makeTestDb();
    const me = worker(db, 513, "Аня");
    const done = createShift(db, { employeeId: me.id, date: day(-3), endDate: day(-1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 513);

    const res = await app.request(new Request(`http://x/api/my/entries/${done.id}`, authed(token, {
      category: "sick_leave", date: day(-3), endDate: day(2),
    }, "PATCH")));

    expect(res.status).toBe(400);
    expect(getShift(db, done.id)!.endDate).toBe(day(-1));
  });

  it("extends a running sick leave — that is what «продлить» means here", async () => {
    const db = makeTestDb();
    const me = worker(db, 514, "Аня");
    const running = createShift(db, { employeeId: me.id, date: day(-2), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 514);

    const res = await app.request(new Request(`http://x/api/my/entries/${running.id}`, authed(token, {
      category: "sick_leave", date: day(-2), endDate: day(4),
    }, "PATCH")));

    expect(res.status).toBe(200);
    expect(getShift(db, running.id)!.endDate).toBe(day(4));
  });

  it("refuses to turn one's own sick leave into an event", async () => {
    const db = makeTestDb();
    const me = worker(db, 515, "Аня");
    const sick = createShift(db, { employeeId: me.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 515);

    const res = await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, {
      category: "offsite", date: day(1), start: "10:00", end: "12:00", title: "Не болею",
    }, "PATCH")));

    expect(res.status).toBe(400);
    expect(getShift(db, sick.id)!.category).toBe("sick_leave");
  });

  it("dropping «по какое» actually shortens the record", async () => {
    const db = makeTestDb();
    const me = worker(db, 516, "Аня");
    const sick = createShift(db, { employeeId: me.id, date: day(0), endDate: day(5), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 516);

    await app.request(new Request(`http://x/api/my/entries/${sick.id}`, authed(token, {
      category: "sick_leave", date: day(0), endDate: null,
    }, "PATCH")));

    expect(getShift(db, sick.id)!.endDate).toBeNull();
  });
});

describe("DELETE /api/my/entries/:id", () => {
  it("refuses to delete a shift — that is the schedule, not a self entry", async () => {
    const db = makeTestDb();
    const me = worker(db, 521, "Аня");
    const shift = createShift(db, { employeeId: me.id, date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 521);

    const res = await app.request(new Request(`http://x/api/my/entries/${shift.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(400);
    expect(getShift(db, shift.id)).toBeDefined();
  });

  it("removes the worker's own event and journals it as a self entry", async () => {
    const db = makeTestDb();
    const me = worker(db, 522, "Аня");
    const event = createShift(db, {
      employeeId: me.id, date: day(3), start: "14:00", end: "16:00", category: "offsite", title: "Конференция",
    });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 522);

    const res = await app.request(new Request(`http://x/api/my/entries/${event.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    expect(getShift(db, event.id)).toBeUndefined();
    expect(listRecentAudit(db, 10).map((r) => r.type)).toContain("self_entry_deleted");
  });

  it("answers 404 for somebody else's entry and leaves it standing", async () => {
    const db = makeTestDb();
    worker(db, 523, "Аня");
    const other = worker(db, 524, "Игорь");
    const theirs = createShift(db, { employeeId: other.id, date: day(1), endDate: day(1), category: "sick_leave" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 523);

    const res = await app.request(new Request(`http://x/api/my/entries/${theirs.id}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(404);
    expect(getShift(db, theirs.id)).toBeDefined();
  });
});

describe("своя смена наблюдателя", () => {
  it("с выключенным тумблером — 403 и ни одной записи", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 601, "Аня", false);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 601);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00",
    })));

    expect(res.status).toBe(403);
    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id)).toHaveLength(0);
  });

  it("с включённым — записывает смену на себя", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 602, "Игорь", true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 602);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", location: "Поклонка",
    })));

    expect(res.status).toBe(201);
    const mine = listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === me.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.category).toBe("shift");
    expect(mine[0]!.start).toBe("09:00");
    // Пресеты — инструмент админа: своя смена не привязана к шаблону.
    expect(mine[0]!.templateId).toBeNull();
  });

  it("чужую смену наблюдатель поставить не может — «кому» в теле нет", async () => {
    const db = makeTestDb();
    observerWorker(db, 603, "Марк", true);
    const other = worker(db, 604, "Даша");
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 603);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00", employeeId: other.id,
    })));

    expect(listShiftsInRange(db, day(1), day(1)).filter((s) => s.employeeId === other.id)).toHaveLength(0);
  });

  it("больничный наблюдателя не поднимает лестницу передачи смены", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 605, "Аня", true);
    worker(db, 606, "Игорь");
    // Своя смена на тот же день — обязательна. Без неё `startHandovers` строит
    // пустой список смен для передачи ДО того, как гейт вообще успевает
    // сработать (`handover-service.ts`: список кандидатов строится из смен
    // самого болеющего), и «handovers: []» была бы пустой в любом случае —
    // проверка не отличила бы работающее правило от отсутствующего. Со своей
    // сменой на дату больничного список без гейта был бы непустым.
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    // An approving admin, so the check below is about the role gate and not about waiting for the «ОК».
    const boss = worker(db, 609, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 605);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));

    expect(res.status).toBe(201);
    const body = await res.json();
    await approveSickLeave(sickApprovalDeps(null, db, config), body.entry.id, boss.id);
    expect(body.handovers).toEqual([]);
    // И в базе тоже пусто: пустой ответ маршрута мог бы означать «создали, но не
    // показали». `listHandoversForEntry` ищет по `sickEntryId` — это тот самый id.
    expect(listHandoversForEntry(db, body.entry.id)).toHaveLength(0);
  });

  it("больничный обычного работника лестницу поднимает — правило про роль, а не про маршрут", async () => {
    const db = makeTestDb();
    const me = worker(db, 607, "Аня");
    const mate = worker(db, 608, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    expect(mate.id).toBeDefined();
    const boss = worker(db, 610, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 607);

    const res = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));

    // The ladder starts at the «ОК», not at the booking — and then it does start for a worker.
    const entryId = (await res.json()).entry.id;
    await approveSickLeave(sickApprovalDeps(null, db, config), entryId, boss.id);
    expect(listHandoversForEntry(db, entryId)).not.toHaveLength(0);
  });
});

/**
 * Роль закрывает ЗАПУСК лестницы, а не её уборку.
 *
 * Первая версия гейта (раунд 2 ревью) заворачивала PATCH и DELETE целиком в
 * `&& !me.isObserver` — по образцу POST. Это было смазанной границей: POST
 * решает «начинать ли», а PATCH и DELETE могут иметь дело с лестницей,
 * поднятой ДО того, как человек стал наблюдателем (обычный работник заболел,
 * лестница пошла, потом админ сделал его наблюдателем). Гасить её и
 * отвязывать от FK нужно всегда — иначе `deleteShift` падает на живой
 * `handovers.sickEntryId`, а укороченный больничный оставляет неактуальные
 * предложения висеть. Только СТАРТ новой лестницы (`startHandovers`)
 * остаётся под ролью.
 */
describe("гейт передачи смены — роль закрывает запуск, не уборку", () => {
  it("PATCH: у наблюдателя startHandovers не зовётся, cancelHandoversForEntry зовётся всегда", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 616, "Аня", true);
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 616);

    // An APPROVED record (all approval columns NULL), shortened below: a pending one would
    // skip `startHandovers` for the wrong reason — waiting — and this test is about the role gate.
    const entryId = createShift(db, { employeeId: me.id, date: day(1), endDate: day(2), category: "sick_leave" }).id;
    const cancelBefore = vi.mocked(cancelHandoversForEntry).mock.calls.length;
    const startBefore = vi.mocked(startHandovers).mock.calls.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, {
      category: "sick_leave", date: day(1), endDate: day(1),
    }, "PATCH")));

    expect(res.status).toBe(200);
    // Гашение — не под ролью: зовётся всегда, даже если гасить нечего.
    expect(vi.mocked(cancelHandoversForEntry).mock.calls.length).toBeGreaterThan(cancelBefore);
    // А новый запуск — под ролью, как и в POST.
    expect(vi.mocked(startHandovers).mock.calls.length).toBe(startBefore);
  });

  it("PATCH: у обычного работника оба вызова происходят", async () => {
    const db = makeTestDb();
    const me = worker(db, 617, "Аня");
    const mate = worker(db, 618, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    expect(mate.id).toBeDefined();
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 617);

    // Approved and then SHORTENED: no «ОК» is needed, so a worker's `startHandovers` runs —
    // the reference point that makes the observer's «not called» above prove the role gate.
    const entryId = createShift(db, { employeeId: me.id, date: day(1), endDate: day(2), category: "sick_leave" }).id;
    const cancelBefore = vi.mocked(cancelHandoversForEntry).mock.calls.length;
    const startBefore = vi.mocked(startHandovers).mock.calls.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, {
      category: "sick_leave", date: day(1), endDate: day(1),
    }, "PATCH")));

    expect(res.status).toBe(200);
    // Опорная точка для теста выше: без роли позваны оба — значит «не позван
    // startHandovers у наблюдателя» доказывает именно гейт, а не то, что
    // вызывать было нечего.
    expect(vi.mocked(cancelHandoversForEntry).mock.calls.length).toBeGreaterThan(cancelBefore);
    expect(vi.mocked(startHandovers).mock.calls.length).toBeGreaterThan(startBefore);
  });

  it("DELETE: у наблюдателя cancelHandoversForEntry и detachHandoversFromEntry зовутся тоже", async () => {
    const db = makeTestDb();
    const me = observerWorker(db, 619, "Аня", true);
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 619);

    const created = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));
    const entryId = (await created.json()).entry.id;
    const cancelBefore = vi.mocked(cancelHandoversForEntry).mock.calls.length;
    const detachBefore = vi.mocked(detachHandoversFromEntry).mock.calls.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    // Раунд 2 проверял обратное («не позваны») — это и был смазанный гейт.
    // Уборка не под ролью: у наблюдателя оба вызова происходят точно так же,
    // как у обычного работника.
    expect(vi.mocked(cancelHandoversForEntry).mock.calls.length).toBeGreaterThan(cancelBefore);
    expect(vi.mocked(detachHandoversFromEntry).mock.calls.length).toBeGreaterThan(detachBefore);
  });

  it("DELETE: у обычного работника оба вызова происходят", async () => {
    const db = makeTestDb();
    const me = worker(db, 620, "Аня");
    const mate = worker(db, 621, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    expect(mate.id).toBeDefined();
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 620);

    const created = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));
    const entryId = (await created.json()).entry.id;
    const cancelBefore = vi.mocked(cancelHandoversForEntry).mock.calls.length;
    const detachBefore = vi.mocked(detachHandoversFromEntry).mock.calls.length;

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    expect(vi.mocked(cancelHandoversForEntry).mock.calls.length).toBeGreaterThan(cancelBefore);
    expect(vi.mocked(detachHandoversFromEntry).mock.calls.length).toBeGreaterThan(detachBefore);
  });
});

/**
 * Регресс с ролью, поменявшейся ПОСЛЕ того, как лестница уже поднялась.
 *
 * Это ровно тот сценарий, на котором прошлый раунд гейта ломался: обычный
 * работник заболевает — лестница поднимается по-настоящему (не спай, а
 * реальные строки `handovers`, потому что тут важно именно поведение с
 * живым FK) — админ ПОСЛЕ ЭТОГО делает его наблюдателем — и через тот же
 * маршрут `/api/my/entries` человек правит или удаляет свой старый больничный.
 * До этого исправления `DELETE` падал на `FOREIGN KEY constraint failed`
 * (редактор ошибок сервера превращает это в `invalid_reference`, 400 — но не
 * 200 — то есть запись НЕ удаляется, а API возвращает ошибку по операции,
 * которая обязана была пройти).
 */
describe("роль поменялась после того, как лестница уже поднялась", () => {
  it("DELETE не падает, запись удаляется, передачи отвязаны — а не висят на удалённой записи", async () => {
    const db = makeTestDb();
    const me = worker(db, 622, "Аня");
    const mate = worker(db, 623, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    const boss = worker(db, 626, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 622);

    const created = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1),
    })));
    expect(created.status).toBe(201);
    const entryId = (await created.json()).entry.id;
    // The ladder rises at the «ОК» (the booking only asks for it).
    await approveSickLeave(sickApprovalDeps(null, db, config), entryId, boss.id);
    // Лестница действительно поднялась, пока Аня была обычным работником —
    // иначе весь остальной тест доказывал бы пустоту, которая была бы пустой
    // и без сценария.
    const raised = listHandoversForEntry(db, entryId);
    expect(raised.length).toBeGreaterThan(0);
    expect(mate.id).toBeDefined();

    // Админ повышает её ПОСЛЕ того, как лестница уже стоит.
    setEmployeeObserver(db, me.id, true);

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, undefined, "DELETE")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getShift(db, entryId)).toBeUndefined();
    // Отвязаны, а не висят: `listHandoversForEntry` ищет по `sickEntryId`,
    // и после отвязки строки под этим id больше не находятся —
    // хотя сами строки передач остались как история (`getHandover` по id).
    expect(listHandoversForEntry(db, entryId)).toHaveLength(0);
    for (const h of raised) {
      const after = getHandover(db, h.id);
      expect(after).toBeDefined();
      expect(after!.sickEntryId).toBeNull();
    }
  });

  it("PATCH (укоротить старый больничный) тоже не падает и гасит лишний день", async () => {
    const db = makeTestDb();
    const me = worker(db, 624, "Аня");
    const mate = worker(db, 625, "Игорь");
    createShift(db, { date: day(1), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    createShift(db, { date: day(2), start: "09:00", end: "18:00", employeeId: me.id, category: "shift" });
    const boss = worker(db, 627, "Марк");
    setEmployeeAdmin(db, boss.id, true);
    const app = createApp({ db, config, bot: undefined });
    const token = await tokenFor(app, 624);

    const created = await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "sick_leave", date: day(1), endDate: day(2),
    })));
    expect(created.status).toBe(201);
    const entryId = (await created.json()).entry.id;
    await approveSickLeave(sickApprovalDeps(null, db, config), entryId, boss.id);
    const raised = listHandoversForEntry(db, entryId);
    // Оба дня — иначе укорачивать нечего.
    expect(raised.length).toBeGreaterThanOrEqual(2);
    expect(mate.id).toBeDefined();

    setEmployeeObserver(db, me.id, true);

    const res = await app.request(new Request(`http://x/api/my/entries/${entryId}`, authed(token, {
      category: "sick_leave", date: day(1), endDate: day(1),
    }, "PATCH")));

    expect(res.status).toBe(200);
    // День 2 больше не покрыт больничным — его передача должна погаситься
    // (`cancelled`), а не остаться висеть предложением на смену, которую
    // болеющий на самом деле выйдет работать.
    const stillLive = listHandoversForEntry(db, entryId).filter((h) => h.status === "offered" || h.status === "fanned");
    const day2Shift = listShiftsInRange(db, day(2), day(2)).find((s) => s.employeeId === me.id && s.category === "shift");
    expect(stillLive.some((h) => h.shiftId === day2Shift?.id)).toBe(false);
  });
});

describe("письмо админам про правку наблюдателя", () => {
  it("правку наблюдателя админам шлёт отдельный вид письма, и его можно выключить", async () => {
    const db = makeTestDb();
    observerWorker(db, 611, "Аня", true);
    const boss = worker(db, 612, "Игорь");
    setEmployeeAdmin(db, boss.id, true);
    const quiet = worker(db, 613, "Марк");
    setEmployeeAdmin(db, quiet.id, true);
    setNoticeMuted(db, quiet.id, "observer_entries", true);

    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 611);

    await app.request(new Request("http://x/api/my/entries", authed(token, {
      category: "shift", date: day(1), start: "09:00", end: "18:00",
    })));

    expect(sent.map((m) => m.to)).toEqual([612]);
    expect(sent[0]!.text).toContain("поставил(а) себе смену");
  });

  it("больничный обычного работника по-прежнему идёт видом self_entries", async () => {
    const db = makeTestDb();
    worker(db, 614, "Даша");
    const boss = worker(db, 615, "Игорь");
    setEmployeeAdmin(db, boss.id, true);
    setNoticeMuted(db, boss.id, "observer_entries", true);

    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 614);

    await app.request(new Request("http://x/api/my/entries", authed(token, { category: "sick_leave", date: day(1) })));

    // Мьют «наблюдателей» не должен глушить письма про команду; а запрос ОК нельзя
    // заглушить вовсе — на нём висит передача смены.
    expect(sent.map((m) => m.to)).toContain(615);
  });
});
