import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { createHandover, getHandover } from "../repo/handovers";
import { addApprovalMessage } from "../repo/sick-approvals";
import { takeHandover } from "../handover/handover-service";
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
    expect(sent.some((m) => m.to === 403)).toBe(true);
    const take = await takeHandover(deps, handover.id, marat.id, day(0));
    expect(take.ok).toBe(false);
    expect(getShift(db, work.id)!.employeeId).toBe(anya.id);
  });

  it("deleting an APPROVED sick leave cancels the fan-out and tells the colleagues", async () => {
    const { db, app, sent, sick, handover, igorToken } = await scene({ pending: false });

    const res = await app.request(new Request(`http://x/api/admin/entries/${sick.id}`, authed(igorToken, undefined, "DELETE")));
    expect(res.status).toBe(200);

    expect(getHandover(db, handover.id)!.status).toBe("cancelled");
    expect(getHandover(db, handover.id)!.sickEntryId).toBeNull();
    expect(sent.some((m) => m.to === 403)).toBe(true);
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
    expect(sent.some((m) => m.to === 403)).toBe(true);
  });
});
