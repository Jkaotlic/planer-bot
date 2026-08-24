import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Стартовая вкладка мини-аппа — личная настройка, и хранится она рядом с
 * остальными: та же ручка `PATCH /api/me/settings`, тот же токен вместо id в
 * пути, так что чужую настройку не тронуть.
 */
const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const patch = (token: string, body: unknown) => ({
  method: "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

function worker(db: ReturnType<typeof makeTestDb>, tg: number) {
  const employee = createEmployee(db, { displayName: "Игорь", inviteToken: `inv-${tg}` });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  return employee;
}

describe("PATCH /api/me/settings — стартовая вкладка", () => {
  it("сохраняет выбор и отдаёт его в «кто я»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const igor = worker(db, 333);
    const token = await tokenFor(app, 333);

    const res = await app.request("/api/me/settings", patch(token, { startTab: "team" }));

    expect(res.status).toBe(200);
    expect(getEmployeeById(db, igor.id)!.startTab).toBe("team");
    expect((await (await app.request("/api/me", auth(token))).json()).startTab).toBe("team");
  });

  it("по умолчанию настройки нет вовсе", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 333);
    const me = await (await app.request("/api/me", auth(await tokenFor(app, 333)))).json();
    expect(me.startTab).toBeNull();
  });

  it("возвращает выбор к «Сменам» пустым значением", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const igor = worker(db, 333);
    const token = await tokenFor(app, 333);
    await app.request("/api/me/settings", patch(token, { startTab: "team" }));

    await app.request("/api/me/settings", patch(token, { startTab: null }));

    expect(getEmployeeById(db, igor.id)!.startTab).toBeNull();
  });

  it("отказывает вкладке, которой нет", async () => {
    // Значение приходит с фронта, а фронт бывает старым: неизвестная строка не
    // должна лечь в базу и всплыть годом позже пустым экраном.
    const db = makeTestDb();
    const app = createApp({ db, config });
    const igor = worker(db, 333);
    const res = await app.request("/api/me/settings", patch(await tokenFor(app, 333), { startTab: "нет такой" }));

    expect(res.status).toBe(400);
    expect(getEmployeeById(db, igor.id)!.startTab).toBeNull();
  });

  it("не даёт работнику записать себе «Админ»", async () => {
    // Настройка не должна становиться способом обойти роль — тот же довод, что
    // у тумблера самозаписи рядом.
    const db = makeTestDb();
    const app = createApp({ db, config });
    const igor = worker(db, 333);
    const res = await app.request("/api/me/settings", patch(await tokenFor(app, 333), { startTab: "admin" }));

    expect(res.status).toBe(403);
    expect(getEmployeeById(db, igor.id)!.startTab).toBeNull();
  });

  it("админу «Админ» записать даёт", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const res = await app.request("/api/me/settings", patch(token, { startTab: "admin" }));

    expect(res.status).toBe(200);
    expect((await (await app.request("/api/me", auth(token))).json()).startTab).toBe("admin");
  });

  it("чужую настройку не тронуть: правится только своя", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const igor = worker(db, 333);
    const anya = worker(db, 444);

    await app.request("/api/me/settings", patch(await tokenFor(app, 333), { startTab: "team" }));

    expect(getEmployeeById(db, igor.id)!.startTab).toBe("team");
    expect(getEmployeeById(db, anya.id)!.startTab).toBeNull();
  });
});
