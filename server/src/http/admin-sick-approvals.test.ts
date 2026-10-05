import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { addDaysIso } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { getShift } from "../repo/shifts";
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
    return { db, app, anyaToken, igorToken: await tokenFor(app, 402), markToken: await tokenFor(app, 403), id: created.entry.id as number, sent, edits };
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
