import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { employees } from "../db/schema";
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
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
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

/** Records letters and edits; hands out message ids, without which the service cannot track its letters. */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const edits: { chat: number; message: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => {
        sent.push({ to, text });
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

/** Team dates, never the machine's. */
const day = (offset: number) => addDaysIso(teamNow(config.teamTz).date, offset);

describe("/api/admin/sick-approvals", () => {
  async function scene() {
    const db = makeTestDb();
    worker(db, "Аня", 401);
    const igor = worker(db, "Игорь", 402);
    setEmployeeAdmin(db, igor.id, true);
    const mark = worker(db, "Марк", 403);
    setEmployeeAdmin(db, mark.id, true);
    const { bot, sent, edits } = fakeBot();
    const app = createApp({ db, config, bot });
    const anyaToken = await tokenFor(app, 401);
    const created = await (await app.request(new Request("http://x/api/my/entries", authed(anyaToken, { category: "sick_leave", date: day(1) })))).json();
    return { db, app, anyaToken, igorToken: await tokenFor(app, 402), markToken: await tokenFor(app, 403), id: created.entry.id as number, sent, edits, bot };
  }

  it("lists the pending sick leave to an admin and refuses a worker", async () => {
    const { app, anyaToken, igorToken, id } = await scene();
    expect((await app.request("/api/admin/sick-approvals", bearer(anyaToken))).status).toBe(403);
    const body = await (await app.request("/api/admin/sick-approvals", bearer(igorToken))).json();
    expect(body.approvals.map((r: { id: number; employeeName: string }) => [r.id, r.employeeName])).toEqual([[id, "Аня"]]);
  });

  it("approve: 200 for the first admin, 409 «Уже подтвердил(а) Игорь» for the second", async () => {
    const { db, app, igorToken, markToken, id } = await scene();
    const first = await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/approve`, authed(igorToken, {})));
    const second = await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/approve`, authed(markToken, {})));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Уже подтвердил(а) Игорь");
    expect(getShift(db, id)!.approvalRequestedAt).toBeNull();
  });

  it("reject: the entry is gone and a second press answers 404 «Больничного уже нет»", async () => {
    const { db, app, igorToken, id } = await scene();
    expect((await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/reject`, authed(igorToken, {})))).status).toBe(200);
    expect(getShift(db, id)).toBeUndefined();
    const again = await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/reject`, authed(igorToken, {})));
    expect(again.status).toBe(404);
    expect((await again.json()).error).toBe("Больничного уже нет");
  });

  it("an admin deleting a pending sick leave replaces every admin's buttons with «Больничного уже нет»", async () => {
    const { app, igorToken, id, edits } = await scene();
    const res = await app.request(new Request(`http://x/api/admin/entries/${id}`, authed(igorToken, undefined, "DELETE")));
    expect(res.status).toBe(200);
    expect(edits.map((e) => e.chat).sort()).toEqual([402, 403]);
    expect(edits.every((e) => e.text.endsWith("🗑 Больничного уже нет — запись удалил админ"))).toBe(true);
  });

  it("an admin's DELETE: a ✅ pressed on a not-yet-edited copy meanwhile loses, and the worker gets no false «Выбери, кому предложить смены»", async () => {
    const { db, app, bot, igorToken, markToken, id, sent, edits } = await scene();
    const sentBefore = sent.length;
    let late: number | null = null;
    // Right after the first letter is edited the second admin presses «ОК» on his copy, still holding live buttons.
    const realEdit = bot.api.editMessageText as unknown as (...a: unknown[]) => Promise<unknown>;
    (bot.api as { editMessageText: unknown }).editMessageText = async (...args: unknown[]) => {
      const result = await realEdit(...args);
      if (late === null) late = (await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/approve`, authed(markToken, {})))).status;
      return result;
    };

    const res = await app.request(new Request(`http://x/api/admin/entries/${id}`, authed(igorToken, undefined, "DELETE")));

    expect(res.status).toBe(200);
    // Wrong implementation caught: the request is still open during the edits, so the ✅ wins it (200).
    expect(late).not.toBe(200);
    expect(getShift(db, id)).toBeUndefined();
    expect(edits.every((e) => e.text.endsWith("🗑 Больничного уже нет — запись удалил админ"))).toBe(true);
    expect(sent.slice(sentBefore).some((m) => m.to === 401)).toBe(false);
  });

  it("an admin re-categorising a pending sick leave clears the request: buttons closed, nothing pending now or after switching back", async () => {
    const { db, app, igorToken, markToken, id, edits } = await scene();
    const patch = (body: unknown) => app.request(new Request(`http://x/api/admin/entries/${id}`, authed(igorToken, body, "PATCH")));

    expect((await patch({ category: "vacation" })).status).toBe(200);

    const row = getShift(db, id)!;
    // Wrong implementation caught: the columns survive on a row that is not a sick leave any more.
    expect([row.category, row.approvalRequestedAt, row.approvedByEmployeeId, row.approvedDate]).toEqual(["vacation", null, null, null]);
    expect(edits.map((e) => e.chat).sort()).toEqual([402, 403]);
    expect(edits.every((e) => e.text.endsWith("🗑 Больничного уже нет — запись изменил(а) Игорь"))).toBe(true);
    // A late ✅ on the old letter: refused in words, nothing started.
    const late = await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/approve`, authed(markToken, {})));
    expect(late.status).toBe(404);
    // Switching back must not resurrect the old question.
    expect((await patch({ category: "sick_leave" })).status).toBe(200);
    expect(getShift(db, id)!.approvalRequestedAt).toBeNull();
  });

  describe("an admin editing the dates of a pending EXTENSION", () => {
    /** Аня's approved day(1)–day(2) stretched by her to day(3): pending, snapshot day(1)–day(2). */
    async function extensionScene() {
      const base = await scene();
      const anya = db0(base.db, "Аня");
      const approved = createShift(base.db, { employeeId: anya, date: day(1), endDate: day(2), category: "sick_leave" });
      const res = await base.app.request(new Request(`http://x/api/my/entries/${approved.id}`, authed(base.anyaToken, { category: "sick_leave", date: day(1), endDate: day(3) }, "PATCH")));
      expect(res.status).toBe(200);
      expect(getShift(base.db, approved.id)!.approvedDate).toBe(day(1));
      base.edits.length = 0;
      const patch = (body: unknown) => base.app.request(new Request(`http://x/api/admin/entries/${approved.id}`, authed(base.igorToken, body, "PATCH")));
      return { ...base, approved, patch };
    }
    const db0 = (db: Db, name: string) => db.select().from(employees).all().find((e) => e.displayName === name)!.id;

    it("redraws the letters and intersects the approved span with the new dates", async () => {
      const { db, approved, patch, edits } = await extensionScene();
      expect((await patch({ date: day(2), endDate: day(4) })).status).toBe(200);
      const row = getShift(db, approved.id)!;
      // Wrong implementation caught: the snapshot keeps day(1), which the new dates dropped — a ❌ would resurrect it.
      expect([row.approvedDate, row.approvedEndDate]).toEqual([day(2), null]);
      expect(row.approvalRequestedAt).not.toBeNull();
      // Both admins' letters now name the new extension (day(3)–day(4)) — and carry no outcome line.
      expect(edits.map((e) => e.chat).sort()).toEqual([402, 403]);
      expect(edits.every((e) => e.text.startsWith("🤒 Аня — продление больничного: ") && !e.text.includes("✅") && !e.text.includes("🗑"))).toBe(true);
    });

    it("back inside the approved span: the request is withdrawn and the letters say so", async () => {
      const { db, approved, patch, edits } = await extensionScene();
      expect((await patch({ date: day(1), endDate: day(2) })).status).toBe(200);
      expect(getShift(db, approved.id)!.approvalRequestedAt).toBeNull();
      expect(edits.every((e) => e.text.endsWith("↩️ Продление снято — ОК не нужен"))).toBe(true);
      expect(edits).toHaveLength(2);
    });
  });

  it("a worker cannot approve or reject: 403 and the entry stays pending", async () => {
    const { db, app, anyaToken, id } = await scene();
    for (const action of ["approve", "reject"]) {
      const res = await app.request(new Request(`http://x/api/admin/sick-approvals/${id}/${action}`, authed(anyaToken, {})));
      // Wrong implementation caught: a route without `requireAdmin` lets the worker approve their own sick leave.
      expect(res.status).toBe(403);
    }
    expect(getShift(db, id)!.approvalRequestedAt).not.toBeNull();
  });
});
