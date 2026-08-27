import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/** A bot that records what it was asked to send instead of talking to Telegram. */
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

const ASOF = "asOf=2026-08-10";

async function coffeeRound(app: ReturnType<typeof createApp>, token: string) {
  const created = await (await app.request(new Request("http://x/api/admin/collections",
    send(token, { title: "Кофемашина", amountPerPerson: 500, collectUrl: "https://example.test/c/1" }, "POST")))).json();
  return created.collection.id as number;
}

/** Аня — админ, Игорь — обычный работник. Сбор общий, без виновника. */
async function twoPeople() {
  const db = makeTestDb();
  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const admin = person(db, "Аня", 100);
  setEmployeeAdmin(db, admin, true);
  const igor = person(db, "Игорь", 101);
  const adminToken = await tokenFor(app, 100);
  const igorToken = await tokenFor(app, 101);
  const id = await coffeeRound(app, adminToken);
  return { db, app, sent, admin, igor, adminToken, igorToken, id };
}

describe("POST /api/collections/:id/paid", () => {
  it("работник отмечает себя, счёт растёт", async () => {
    const { app, adminToken, igorToken, id } = await twoPeople();
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));

    const res = await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: true }, "POST")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paid: true, paidCount: 1, recipientCount: 2 });
  });

  it("галочка снимается", async () => {
    const { app, adminToken, igorToken, id } = await twoPeople();
    // Рассылка обязательна: до неё сбор для работника не существует, и роут
    // отдаёт 404 — то самое правило, что виновник не видит свой сбор.
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));

    await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: true }, "POST")));
    const res = await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: false }, "POST")));
    expect((await res.json()).paidCount).toBe(0);
  });

  it("виновник свой сбор отметить не может — он его не видит", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const admin = person(db, "Аня", 100);
    setEmployeeAdmin(db, admin, true);
    const igor = person(db, "Игорь", 101);
    const adminToken = await tokenFor(app, 100);
    const igorToken = await tokenFor(app, 101);
    const created = await (await app.request(new Request("http://x/api/admin/collections",
      send(adminToken, { title: "Свадьба", employeeId: igor, collectUrl: "https://example.test/c/2" }, "POST")))).json();
    await app.request(new Request(`http://x/api/admin/collections/${created.collection.id}/send`, send(adminToken, { confirm: true }, "POST")));

    const res = await app.request(new Request(`http://x/api/collections/${created.collection.id}/paid`,
      send(igorToken, { paid: true }, "POST")));
    expect(res.status).toBe(404);
  });

  it("тело без boolean отбивается", async () => {
    const { app, igorToken, id } = await twoPeople();
    const res = await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: "да" }, "POST")));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/collections", () => {
  it("отдаёт свою галочку и счёт вместе со сбором", async () => {
    const { app, adminToken, igorToken, id } = await twoPeople();
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));
    await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: true }, "POST")));

    const mine = await (await app.request(new Request(`http://x/api/collections?${ASOF}`, auth(igorToken)))).json();
    expect(mine.collections[0]).toMatchObject({ paid: true, paidCount: 1, recipientCount: 2 });

    const anyas = await (await app.request(new Request(`http://x/api/collections?${ASOF}`, auth(adminToken)))).json();
    expect(anyas.collections[0]).toMatchObject({ paid: false, paidCount: 1, recipientCount: 2 });
  });
});

describe("админский список отметок", () => {
  it("отдаёт всех получателей с галочками", async () => {
    const { app, adminToken, igorToken, id } = await twoPeople();
    await app.request(new Request(`http://x/api/admin/collections/${id}/send`, send(adminToken, { confirm: true }, "POST")));
    await app.request(new Request(`http://x/api/collections/${id}/paid`, send(igorToken, { paid: true }, "POST")));

    const body = await (await app.request(new Request(`http://x/api/admin/collections/${id}/payments`, auth(adminToken)))).json();
    expect(body.paidCount).toBe(1);
    expect(body.total).toBe(2);
    expect(body.rows.find((r: { displayName: string }) => r.displayName === "Игорь")).toMatchObject({ paid: true, markedByAdmin: false });
    expect(body.rows.find((r: { displayName: string }) => r.displayName === "Аня")).toMatchObject({ paid: false });
  });

  it("админ отмечает за другого — галочка помечена как поставленная чужой рукой", async () => {
    const { app, adminToken, igor, id } = await twoPeople();

    const res = await app.request(new Request(`http://x/api/admin/collections/${id}/payments/${igor}`,
      send(adminToken, { paid: true }, "POST")));
    expect(res.status).toBe(200);

    const body = await (await app.request(new Request(`http://x/api/admin/collections/${id}/payments`, auth(adminToken)))).json();
    expect(body.rows.find((r: { displayName: string }) => r.displayName === "Игорь")).toMatchObject({ paid: true, markedByAdmin: true });
  });

  it("отметка за другого пишется в журнал, своя — нет", async () => {
    const { db, app, adminToken, admin, igor, id } = await twoPeople();

    await app.request(new Request(`http://x/api/admin/collections/${id}/payments/${igor}`, send(adminToken, { paid: true }, "POST")));
    await app.request(new Request(`http://x/api/admin/collections/${id}/payments/${admin}`, send(adminToken, { paid: true }, "POST")));

    const marked = listRecentAudit(db, 50).filter((row) => row.type === "collection_payment_marked");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.payload).toMatchObject({ payerId: igor, paid: true });
  });

  it("не-админа к списку не пускают", async () => {
    const { app, igorToken, id } = await twoPeople();
    const res = await app.request(new Request(`http://x/api/admin/collections/${id}/payments`, auth(igorToken)));
    expect(res.status).toBe(403);
  });
});
