import { describe, it, expect } from "vitest";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
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
  person(db, "Марк", 102);
  return { db, app, anya, igor, anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102) };
}

describe("места по HTTP", () => {
  it("работник создаёт место, другой видит его в списке и правит", async () => {
    const { app, anyaT, igorT } = await stage();
    const created = await app.request(new Request("http://x/api/food-places",
      send(anyaT, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] })));
    expect(created.status).toBe(201);
    const { place } = await created.json();
    const list = await (await app.request(new Request("http://x/api/food-places", get(igorT)))).json();
    expect(list.places.map((p: { name: string }) => p.name)).toEqual(["Шаурмечная"]);
    const edited = await app.request(new Request(`http://x/api/food-places/${place.id}`,
      send(igorT, { name: "Шаурмечная", menu: [{ id: place.menu[0].id, name: "Шаурма", price: 380 }] }, "PUT")));
    expect((await edited.json()).place.menu[0].price).toBe(380);
  });

  it("кривое меню — 400 с русской причиной", async () => {
    const { app, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/food-places",
      send(anyaT, { name: "X", menu: [{ name: "Y", price: 0 }] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Проверь/);
  });

  it("удаление убирает место из списка", async () => {
    const { app, anyaT } = await stage();
    const { place } = await (await app.request(new Request("http://x/api/food-places", send(anyaT, { name: "Додо", menu: [] })))).json();
    expect((await app.request(new Request(`http://x/api/food-places/${place.id}`, send(anyaT, {}, "DELETE")))).status).toBe(200);
    expect((await (await app.request(new Request("http://x/api/food-places", get(anyaT)))).json()).places).toEqual([]);
  });

  it("голое null вместо тела — 400, а не падение", async () => {
    const { app, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/food-places", send(anyaT, null)));
    expect(res.status).toBe(400);
  });
});
