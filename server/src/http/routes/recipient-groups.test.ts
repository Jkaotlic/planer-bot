import { describe, it, expect } from "vitest";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount, setEmployeeAdmin } from "../../repo/employees";
import { listRecentAudit } from "../../repo/audit";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const send = (token: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const get = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function person(db: Db, name: string, tg: number): number {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  linkTelegramAccount(db, `inv-${name}`, tg);
  return e.id;
}

async function stage() {
  const db = makeTestDb();
  const app = createApp({ db, config });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  setEmployeeAdmin(db, anya, true);
  return { db, app, anya, igor, anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101) };
}

describe("группы по HTTP", () => {
  it("админ создаёт группу, работник видит её в списке", async () => {
    const { app, anyaT, igorT, igor } = await stage();
    const res = await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "ЧИП 5-й этаж", memberIds: [igor] })));
    expect(res.status).toBe(201);
    const list = await (await app.request(new Request("http://x/api/recipient-groups", get(igorT)))).json();
    expect(list.groups).toEqual([{ id: 1, name: "ЧИП 5-й этаж", memberIds: [igor] }]);
  });

  it("работник не может создать, править и удалить группу — 403, база не тронута", async () => {
    const { app, anyaT, igorT } = await stage();
    await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "A", memberIds: [] })));
    expect((await app.request(new Request("http://x/api/admin/recipient-groups", send(igorT, { name: "B", memberIds: [] })))).status).toBe(403);
    expect((await app.request(new Request("http://x/api/admin/recipient-groups/1", send(igorT, { name: "Z" }, "PUT")))).status).toBe(403);
    expect((await app.request(new Request("http://x/api/admin/recipient-groups/1", send(igorT, {}, "DELETE")))).status).toBe(403);
    const list = await (await app.request(new Request("http://x/api/recipient-groups", get(igorT)))).json();
    expect(list.groups.map((g: { name: string }) => g.name)).toEqual(["A"]);
  });

  it("кривое имя — 400, дубликат — 409 с текстом, удаление — затем 404", async () => {
    const { app, anyaT } = await stage();
    expect((await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "", memberIds: [] })))).status).toBe(400);
    await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "A", memberIds: [] })));
    const dup = await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "a", memberIds: [] })));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("Группа с таким названием уже есть.");
    expect((await app.request(new Request("http://x/api/admin/recipient-groups/1", send(anyaT, {}, "DELETE")))).status).toBe(200);
    expect((await app.request(new Request("http://x/api/admin/recipient-groups/1", send(anyaT, {}, "DELETE")))).status).toBe(404);
  });

  it("правка пишет аудит с числом участников", async () => {
    const { app, db, anyaT, igor } = await stage();
    await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "A", memberIds: [] })));
    await app.request(new Request("http://x/api/admin/recipient-groups/1", send(anyaT, { memberIds: [igor] }, "PUT")));
    const row = listRecentAudit(db, 10).find((r) => r.type === "recipient_group_changed" && (r.payload as { action: string }).action === "состав");
    expect(row!.payload).toMatchObject({ groupId: 1, name: "A", members: 1 });
  });

  it("переименование пишет oldName, смена состава — «состав»", async () => {
    const { app, db, anyaT, igor } = await stage();
    await app.request(new Request("http://x/api/admin/recipient-groups", send(anyaT, { name: "A", memberIds: [] })));
    await app.request(new Request("http://x/api/admin/recipient-groups/1", send(anyaT, { name: "B" }, "PUT")));
    await app.request(new Request("http://x/api/admin/recipient-groups/1", send(anyaT, { memberIds: [igor] }, "PUT")));
    const rows = listRecentAudit(db, 10).filter((r) => r.type === "recipient_group_changed").map((r) => r.payload as Record<string, unknown>);
    expect(rows.find((p) => p.action === "переименована")).toMatchObject({ name: "B", oldName: "A" });
    expect(rows.find((p) => p.action === "состав")).toMatchObject({ members: 1 });
    expect(rows.find((p) => p.action === "состав")).not.toHaveProperty("oldName");
  });
});
