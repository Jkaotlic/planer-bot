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
