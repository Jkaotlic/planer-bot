import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { eq } from "drizzle-orm";
import { shifts as shiftsTable } from "../db/schema";
import { createShift, getShift } from "../repo/shifts";
import { createHandover, getHandover } from "../repo/handovers";
import { addApprovalMessage } from "../repo/sick-approvals";
import { takeHandover } from "../handover/handover-service";
import { runHandoverTick } from "../handover/handover-tick";
import { createHandoverMessenger } from "../handover/handover-messenger";
import { signInitData } from "../auth/telegram";
import { teamNow } from "../util/team-time";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

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

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const edits: { chat: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => {
        sent.push({ to, text });
        return { message_id: sent.length };
      }),
      editMessageText: vi.fn(async (chat: number, _message: number, text: string) => {
        edits.push({ chat, text });
        return true;
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent, edits };
}

/**
 * The «отбой» to a colleague on an ADMIN path: it must say the admin changed the schedule and must not
 * blame the worker («снял(а) больничный»), who did nothing here.
 */
function expectAdminCancelText(sent: { to: number; text: string }[]) {
  const letter = sent.find((m) => m.to === 403)!;
  expect(letter.text).toContain("админ");
  expect(letter.text).not.toContain("снял(а) больничный");
  expect(letter.text).not.toContain("Аня");
}

/** Team dates, never the machine's. */
const day = (offset: number) => addDaysIso(teamNow(config.teamTz).date, offset);

/** Anya is on a sick leave tomorrow with a live fan-out for her shift; Marat is the colleague who could take it. */
async function scene(opts: { pending: boolean }) {
  const db = makeTestDb();
  const anya = worker(db, "Аня", 401);
  const igor = worker(db, "Игорь", 402);
  setEmployeeAdmin(db, igor.id, true);
  const marat = worker(db, "Марат", 403);
  const { bot, sent, edits } = fakeBot();
  const app = createApp({ db, config, bot });
  const sick = createShift(db, {
    date: day(1), category: "sick_leave", employeeId: anya.id,
    ...(opts.pending ? { approvalRequestedAt: new Date() } : { approvedByEmployeeId: igor.id }),
  });
  const work = createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
  const handover = createHandover(db, { shiftId: work.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "fanned", escalatedAt: new Date() });
  const deps = { db, config, messenger: createHandoverMessenger(bot, db) };
  return { db, app, sent, edits, sick, work, handover, anya, marat, deps, igorToken: await tokenFor(app, 402) };
}

describe("an admin changes or removes a sick leave that has a live fan-out", () => {
  it("changing the category to vacation cancels the fan-out, tells the colleagues, and «Беру» is refused", async () => {
    const { db, app, sent, sick, work, handover, anya, marat, deps, igorToken } = await scene({ pending: false });

    const res = await app.request(new Request(`http://x/api/admin/entries/${sick.id}`, authed(igorToken, { category: "vacation" }, "PATCH")));
    expect(res.status).toBe(200);

    // A colleague taking the shift of someone who is no longer sick is the defect.
    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expectAdminCancelText(sent);
    const take = await takeHandover(deps, handover.id, marat.id, day(0));
    expect(take.ok).toBe(false);
    expect(getShift(db, work.id)!.employeeId).toBe(anya.id);
  });

  it("moving or shortening an approved sick leave cancels the fan-outs of dropped days at once, with the admin text; covered days stay", async () => {
    const { db, app, sent, sick, work, handover, anya, igorToken } = await scene({ pending: false });
    // The sick leave covers day(1) only in the scene; stretch it to day(2) first, with a second shift and fan-out on day(2).
    db.update(shiftsTable).set({ endDate: day(2) }).where(eq(shiftsTable.id, sick.id)).run();
    const work2 = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const handover2 = createHandover(db, { shiftId: work2.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "fanned", escalatedAt: new Date() });

    const res = await app.request(new Request(`http://x/api/admin/entries/${sick.id}`, authed(igorToken, { endDate: day(1) }, "PATCH")));
    expect(res.status).toBe(200);

    // Straight after the PATCH, not at the next tick: the tick's own void letter would blame the worker.
    expect(getHandover(db, handover2.id)!.status).toBe("cancelled");
    expect(getHandover(db, handover.id)!.status).toBe("fanned");
    expect(getShift(db, work.id)!.employeeId).toBe(anya.id);
    expectAdminCancelText(sent);
    expect(sent.filter((m) => m.to === 403)).toHaveLength(1);
  });

  it("deleting an APPROVED sick leave cancels the fan-out and tells the colleagues", async () => {
    const { db, app, sent, sick, handover, igorToken } = await scene({ pending: false });

    const res = await app.request(new Request(`http://x/api/admin/entries/${sick.id}`, authed(igorToken, undefined, "DELETE")));
    expect(res.status).toBe(200);

    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expect(getHandover(db, handover.id)!.sickEntryId).toBeNull();
    expectAdminCancelText(sent);
  });

  it("archiving the worker with a PENDING sick leave closes the admins' letters and cancels the fan-out", async () => {
    const { db, app, sent, edits, sick, handover, anya, igorToken } = await scene({ pending: true });
    addApprovalMessage(db, sick.id, 402, 77);

    const res = await app.request(new Request(`http://x/api/admin/employees/${anya.id}/archive`, authed(igorToken, {})));
    expect(res.status).toBe(200);

    // Live «ОК» buttons on a request for a row that is gone are the defect.
    expect(edits.map((e) => e.chat)).toEqual([402]);
    expect(edits[0]!.text).toContain("Больничного уже нет");
    expect(getShift(db, sick.id)).toBeUndefined();
    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expectAdminCancelText(sent);
  });

  it("archiving while an approved sick leave is still running: the future one's fan-out is cancelled, not moved onto the running one", async () => {
    // C started yesterday and survives the archive (only absences from today are deleted). Moving A's
    // hand-over onto C would leave it live on a shift the archive is about to hand to «Не назначено» —
    // no «отбой» for the colleagues, an escalation hanging over nobody's shift.
    const { db, app, sent, sick, work, handover, anya, igorToken } = await scene({ pending: false });
    const running = createShift(db, { date: day(-1), endDate: day(1), category: "sick_leave", employeeId: anya.id, approvedByEmployeeId: sick.approvedByEmployeeId });

    const res = await app.request(new Request(`http://x/api/admin/employees/${anya.id}/archive`, authed(igorToken, {})));
    expect(res.status).toBe(200);

    expect(getShift(db, work.id)!.employeeId).toBeNull();
    expect(getShift(db, running.id)).toBeDefined();
    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expectAdminCancelText(sent);
    // One «отбой», not two: A's hand-over is moved onto C and cancelled only by the pass over C's.
    expect(sent.filter((m) => m.to === 403)).toHaveLength(1);
  });

  it("archiving cancels the fan-out of the RUNNING sick leave too, with the admin «отбой», and the tick does not write again", async () => {
    // C began yesterday, so the archive keeps it (only absences from today are deleted) — and its
    // hand-over of the day(2) shift used to stay live until the tick voided it as «смену закрыли»:
    // the worker's wording on a path where only the admin acted.
    const { db, app, sent, sick, anya, deps, igorToken } = await scene({ pending: false });
    const running = createShift(db, { date: day(-1), endDate: day(3), category: "sick_leave", employeeId: anya.id, approvedByEmployeeId: sick.approvedByEmployeeId });
    const later = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const runningHandover = createHandover(db, { shiftId: later.id, fromEmployeeId: anya.id, sickEntryId: running.id, status: "fanned", escalatedAt: new Date() });

    const res = await app.request(new Request(`http://x/api/admin/employees/${anya.id}/archive`, authed(igorToken, {})));
    expect(res.status).toBe(200);

    expect(getShift(db, running.id)).toBeDefined();
    expect(getHandover(db, runningHandover.id)!.status).toBe("cancelled");
    const toMarat = sent.filter((m) => m.to === 403);
    expect(toMarat).toHaveLength(2);
    for (const letter of toMarat) {
      expect(letter.text).toContain("админ");
      expect(letter.text).not.toContain("Аня");
    }

    await runHandoverTick(deps, Date.now());
    expect(sent.filter((m) => m.to === 403)).toHaveLength(2);
  });

  it("archiving the colleague a hand-over was OFFERED to fans it out to everyone else at once, and writes him nothing", async () => {
    // Igor can no longer take anything once archived (canSwap), yet the offer waited on him for
    // `handoverFanHours` before the tick fanned it — hours lost on a shift that is close.
    const db = makeTestDb();
    const anya = worker(db, "Аня", 501);
    const igor = worker(db, "Игорь", 502);
    worker(db, "Марат", 503);
    const mark = worker(db, "Марк", 504);
    setEmployeeAdmin(db, mark.id, true);
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const sick = createShift(db, { date: day(1), category: "sick_leave", employeeId: anya.id, approvedByEmployeeId: mark.id });
    const work = createShift(db, { date: day(1), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const handover = createHandover(db, {
      shiftId: work.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "offered", offeredToEmployeeId: igor.id,
    });
    const markToken = await tokenFor(app, 504);

    const res = await app.request(new Request(`http://x/api/admin/employees/${igor.id}/archive`, authed(markToken, {})));
    expect(res.status).toBe(200);

    const after = getHandover(db, handover.id)!;
    expect(after.status).toBe("fanned");
    expect(after.offeredToEmployeeId).toBeNull();
    const toMarat = sent.filter((m) => m.to === 503);
    expect(toMarat).toHaveLength(1);
    expect(toMarat[0]!.text).toContain("Кто может выйти?");
    expect(sent.filter((m) => m.to === 502)).toHaveLength(0);
    expect(getShift(db, work.id)!.employeeId).toBe(anya.id);
  });
});

/**
 * Замена больничного рабочей записью из диапазона (`replaceAbsences`). Побочки
 * обязаны быть теми же, что у правки и удаления больничного админом: выпавшие
 * дни теряют передачу сразу и с админским «отбоем», письма админам закрываются
 * или перерисовываются, а не остаются с живыми кнопками.
 */
describe("an admin replaces sick days with work through the range", () => {
  const replace = (app: ReturnType<typeof createApp>, token: string, employeeId: number, date: string) =>
    app.request(new Request("http://x/api/admin/entries/range", authed(token, {
      employeeId, from: date, to: date, category: "duty", start: "10:00", end: "19:00",
      mode: "rewrite", replaceAbsences: true, includeWeekends: true,
    })));

  it("a replaced day loses its fan-out with the admin text; the day after keeps its own", async () => {
    const { db, app, sent, sick, work, handover, anya, igorToken } = await scene({ pending: false });
    db.update(shiftsTable).set({ endDate: day(2) }).where(eq(shiftsTable.id, sick.id)).run();
    const work2 = createShift(db, { date: day(2), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const handover2 = createHandover(db, { shiftId: work2.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "fanned", escalatedAt: new Date() });
    const res = await replace(app, igorToken, anya.id, day(1));
    expect(res.status).toBe(201);
    const body = await res.json();
    // Своя смена под больничным переписана на месте, а не задублирована.
    expect(body.updated.map((e: { id: number }) => e.id)).toEqual([work.id]);
    expect(getShift(db, work.id)).toMatchObject({ category: "duty", start: "10:00", employeeId: anya.id });

    expect(getShift(db, sick.id)).toMatchObject({ date: day(2), endDate: null, category: "sick_leave" });
    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expect(getHandover(db, handover2.id)!.status).toBe("fanned");
    expectAdminCancelText(sent);
    expect(sent.filter((m) => m.to === 403)).toHaveLength(1);
  });

  it("split in the middle: the fan-out of the later piece moves onto the new row instead of dying", async () => {
    const { db, app, sent, sick, anya, igorToken } = await scene({ pending: false });
    db.update(shiftsTable).set({ endDate: day(3) }).where(eq(shiftsTable.id, sick.id)).run();
    const work3 = createShift(db, { date: day(3), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const handover3 = createHandover(db, { shiftId: work3.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "fanned", escalatedAt: new Date() });

    expect((await replace(app, igorToken, anya.id, day(2))).status).toBe(201);

    expect(getShift(db, sick.id)).toMatchObject({ date: day(1), endDate: null });
    const after = getHandover(db, handover3.id)!;
    expect(after.status).toBe("fanned");
    expect(after.sickEntryId).not.toBe(sick.id);
    expect(getShift(db, after.sickEntryId!)).toMatchObject({ date: day(3), endDate: null, category: "sick_leave" });
    expect(sent.filter((m) => m.to === 403)).toHaveLength(0);
  });

  // H9 (аудит 2026-10-26): ждущий «ОК» кусок не одобрен, и перенос «на другой
  // одобренный больничный» его не видит — передача гасла, а коллегам уходил
  // «отбой» про человека, который по-прежнему болен. Одобренный разрез выше и
  // этот ждущий закреплены вместе: кусок принимает передачу своих дней в обоих.
  it("a PENDING sick leave split in the middle: the fan-out of the later piece moves onto it as is, colleagues hear nothing", async () => {
    const { db, app, sent, sick, anya, igorToken } = await scene({ pending: true });
    db.update(shiftsTable).set({ endDate: day(3) }).where(eq(shiftsTable.id, sick.id)).run();
    const work3 = createShift(db, { date: day(3), start: "09:00", end: "18:00", category: "shift", title: "День", employeeId: anya.id });
    const fannedAt = new Date(Date.now() - 3_600_000);
    const handover3 = createHandover(db, {
      shiftId: work3.id, fromEmployeeId: anya.id, sickEntryId: sick.id, status: "fanned", escalatedAt: fannedAt, fannedAt,
    });

    expect((await replace(app, igorToken, anya.id, day(2))).status).toBe(201);

    const piece = db.select().from(shiftsTable).where(eq(shiftsTable.date, day(3))).all().find((r) => r.category === "sick_leave")!;
    const after = getHandover(db, handover3.id)!;
    expect(after.status).toBe("fanned");
    expect(after.sickEntryId).toBe(piece.id);
    // Перевешена, а не разослана заново: время рассылки — прежнее.
    expect(after.fannedAt!.getTime()).toBe(Math.floor(fannedAt.getTime() / 1000) * 1000);
    expect(sent.filter((m) => m.to === 403)).toHaveLength(0);
  });

  it("a PENDING one-day sick leave replaced whole: the row is gone, the admins' buttons are closed, the fan-out is off", async () => {
    const { db, app, sent, edits, sick, handover, anya, igorToken } = await scene({ pending: true });
    addApprovalMessage(db, sick.id, 402, 77);

    expect((await replace(app, igorToken, anya.id, day(1))).status).toBe(201);

    expect(getShift(db, sick.id)).toBeUndefined();
    expect(edits.map((e) => e.chat)).toEqual([402]);
    expect(edits[0]!.text).toContain("Больничного уже нет");
    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expectAdminCancelText(sent);
  });

  it("a PENDING sick leave split in the middle: the first piece's letter is redrawn, the second piece asks for its own ОК", async () => {
    const { db, app, sent, edits, sick, anya, igorToken } = await scene({ pending: true });
    db.update(shiftsTable).set({ endDate: day(3) }).where(eq(shiftsTable.id, sick.id)).run();
    addApprovalMessage(db, sick.id, 402, 77);

    expect((await replace(app, igorToken, anya.id, day(2))).status).toBe(201);

    expect(getShift(db, sick.id)).toMatchObject({ date: day(1), endDate: null });
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();
    // Перерисовка, а не второе письмо про ту же заявку.
    expect(edits.filter((e) => e.chat === 402)).toHaveLength(1);
    const piece = db.select().from(shiftsTable).where(eq(shiftsTable.date, day(3))).all().find((r) => r.category === "sick_leave")!;
    expect(piece.approvalRequestedAt).not.toBeNull();
    // Кнопки второго куска — свои: решение по первому не должно решать и его.
    expect(sent.filter((m) => m.to === 402)).toHaveLength(1);
  });

  // Путь `wholly` в cutAbsenceDb: заявка ждёт «ОК» только на раздвинутый назад
  // день, а 2–4 уже одобрены. Вырезан 2-й — второй кусок 3–4 весь из одобренных
  // дней, спрашивать про него нечего: ни своей заявки, ни письма с кнопками.
  it("a PENDING sick leave split so the second piece lies wholly in approved days: no request for that piece", async () => {
    const { db, app, sent, sick, anya, igorToken } = await scene({ pending: true });
    db.update(shiftsTable)
      .set({ endDate: day(4), approvedDate: day(2), approvedEndDate: day(4) })
      .where(eq(shiftsTable.id, sick.id)).run();
    addApprovalMessage(db, sick.id, 402, 77);

    expect((await replace(app, igorToken, anya.id, day(2))).status).toBe(201);

    expect(getShift(db, sick.id)).toMatchObject({ date: day(1), endDate: null });
    expect(getShift(db, sick.id)!.approvalRequestedAt).not.toBeNull();
    const piece = db.select().from(shiftsTable).where(eq(shiftsTable.date, day(3))).all().find((r) => r.category === "sick_leave")!;
    expect(piece).toMatchObject({ endDate: day(4), approvalRequestedAt: null, approvedDate: null, approvedEndDate: null });
    // Первый кусок перерисован на месте, а второй новой заявки не родил.
    expect(sent.filter((m) => m.to === 402)).toHaveLength(0);
  });
});

