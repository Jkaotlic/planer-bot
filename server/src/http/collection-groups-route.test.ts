import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { archiveGroup, createGroup, updateGroup } from "../groups/group-service";
import { getCollection } from "../collections/collection-service";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

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
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const send = (token: string, body: unknown, method: string) => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

function person(db: Db, name: string, tg: number | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return employee.id;
}

/** Аня — админ; группа «ЧИП 5-й этаж» — только Игорь; Марк — посторонний. */
async function stage() {
  const db = makeTestDb();
  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  setEmployeeAdmin(db, anya, true);
  const igor = person(db, "Игорь", 101);
  const mark = person(db, "Марк", 102);
  const made = createGroup(db, { name: "ЧИП 5-й этаж", memberIds: [igor] }, anya);
  const groupId = made.group!.id;
  const adminToken = await tokenFor(app, 100);
  const igorToken = await tokenFor(app, 101);
  const markToken = await tokenFor(app, 102);
  return { db, app, sent, anya, igor, mark, groupId, adminToken, igorToken, markToken };
}

async function create(app: ReturnType<typeof createApp>, token: string, body: Record<string, unknown>) {
  return app.request(new Request("http://x/api/admin/collections", send(token, {
    title: "Кофемашина", amountPerPerson: 500, collectUrl: "https://example.test/c/1", ...body,
  }, "POST")));
}

describe("сбор по группе через HTTP", () => {
  it("превью, рассылка, видимость и отметка — только группа", async () => {
    const { db, app, sent, igor, groupId, adminToken, igorToken, markToken } = await stage();
    const res = await create(app, adminToken, { recipientGroupId: groupId });
    expect(res.status).toBe(200);
    const id = (await res.json()).collection.id as number;
    expect(listRecentAudit(db, 5).find((r) => r.type === "collection_created")?.payload)
      .toMatchObject({ recipientGroupId: groupId });

    const preview = await (await app.request(`/api/admin/collections/${id}/preview`, auth(adminToken))).json();
    expect(preview.recipientGroupName).toBe("ЧИП 5-й этаж");
    expect(preview.recipients).toEqual([{ employeeId: igor, displayName: "Игорь" }]);

    const sentRes = await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));
    expect(await sentRes.json()).toMatchObject({ delivered: 1, intended: 1 });
    expect(sent.map((m) => m.to)).toEqual([101]);

    const markList = await (await app.request("/api/collections", auth(markToken))).json();
    expect(markList.collections).toEqual([]);
    const igorList = await (await app.request("/api/collections", auth(igorToken))).json();
    expect(igorList.collections.map((c: { id: number }) => c.id)).toEqual([id]);

    const markPaid = await app.request(new Request(`http://x/api/collections/${id}/paid`, send(markToken, { paid: true }, "POST")));
    expect(markPaid.status).toBe(404);
    const igorPaid = await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: true }, "POST")));
    expect(await igorPaid.json()).toEqual({ paid: true, paidCount: 1, recipientCount: 1 });
  });

  it("«Напомнить» после переезда в группу пишет только зафиксированным адресатам", async () => {
    const { db, app, sent, igor, mark, groupId, adminToken } = await stage();
    const id = (await (await create(app, adminToken, { recipientGroupId: groupId })).json()).collection.id as number;
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));
    updateGroup(db, groupId, { memberIds: [igor, mark] });
    sent.length = 0;

    const res = await app.request(new Request(`http://x/api/admin/collections/${id}/remind-unpaid`, send(adminToken, { confirm: true }, "POST")));
    expect(await res.json()).toEqual({ delivered: 1, intended: 1 });
    expect(sent.map((m) => m.to)).toEqual([101]);
  });

  it("после рассылки сменить группу нельзя — 409 с текстом, в базе прежняя", async () => {
    const { db, app, anya, groupId, adminToken } = await stage();
    const other = createGroup(db, { name: "ЧИП 32 этаж", memberIds: [anya] }, anya).group!.id;
    const id = (await (await create(app, adminToken, { recipientGroupId: groupId })).json()).collection.id as number;
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));

    const res = await app.request(new Request(`http://x/api/admin/collections/${id}`, send(adminToken, { recipientGroupId: other }, "PUT")));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Сбор уже разослан — адресатов менять нельзя." });
    expect(getCollection(db, id)?.recipientGroupId).toBe(groupId);
  });

  it("до рассылки группу можно сменить, и это видно в журнале", async () => {
    const { db, app, anya, groupId, adminToken } = await stage();
    const other = createGroup(db, { name: "ЧИП 32 этаж", memberIds: [anya] }, anya).group!.id;
    const id = (await (await create(app, adminToken, { recipientGroupId: groupId })).json()).collection.id as number;

    const res = await app.request(new Request(`http://x/api/admin/collections/${id}`, send(adminToken, { recipientGroupId: other }, "PUT")));
    expect(res.status).toBe(200);
    expect(getCollection(db, id)?.recipientGroupId).toBe(other);
    expect(listRecentAudit(db, 5).find((r) => r.type === "collection_updated")?.payload)
      .toMatchObject({ recipientGroupId: other });
  });

  it("несуществующая или удалённая группа — 409 «Такой группы нет.», сбор не создан и не изменён", async () => {
    const { db, app, groupId, adminToken } = await stage();
    const missing = await create(app, adminToken, { recipientGroupId: 999 });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "Такой группы нет." });

    const id = (await (await create(app, adminToken, {})).json()).collection.id as number;
    archiveGroup(db, groupId);
    const archived = await app.request(new Request(`http://x/api/admin/collections/${id}`, send(adminToken, { recipientGroupId: groupId }, "PUT")));
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: "Такой группы нет." });
    expect(getCollection(db, id)?.recipientGroupId).toBeNull();

    const bad = await create(app, adminToken, { recipientGroupId: "ЧИП" });
    expect(bad.status).toBe(400);
  });

  it("день рождения принимает группу; удалённую — нет", async () => {
    const { db, app, groupId, adminToken } = await stage();
    const vera = person(db, "Вера", 103);
    setBirthDate(db, vera, "08-05");

    const ok = await app.request(`/api/admin/birthdays/${vera}?asOf=2026-08-01`, send(adminToken, { recipientGroupId: groupId }, "PUT"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).collection.recipientGroupId).toBe(groupId);

    archiveGroup(db, groupId);
    const gone = await app.request(`/api/admin/birthdays/${vera}?asOf=2026-08-01`, send(adminToken, { recipientGroupId: groupId }, "PUT"));
    expect(gone.status).toBe(409);
    expect(await gone.json()).toEqual({ error: "Такой группы нет." });
  });
});
