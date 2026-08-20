import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import {
  archiveEmployee,
  createEmployee,
  getByTelegramId,
  linkTelegramAccount,
  setEmployeeAdmin,
} from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;

describe("blanket /api/admin/* guard", () => {
  it("blocks a made-up admin path for a non-admin, even with no inline guard", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const app = createApp({ db, config });
    // A path under /api/admin/ that has no handler: the guard must still 403 (not 404) for a worker.
    const res = await app.request("/api/admin/does-not-exist", { headers: { Authorization: `Bearer ${await tokenFor(app, 333)}` } });
    expect(res.status).toBe(403);
  });

  it("lets an admin through to a real admin route", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/employees", { headers: { Authorization: `Bearer ${await tokenFor(app, 111)}` } });
    expect(res.status).toBe(200);
  });

  it("rejects an already-issued admin JWT immediately after demotion", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const admin = getByTelegramId(db, 111);
    expect(admin).toBeDefined();
    setEmployeeAdmin(db, admin!.id, false);

    const res = await app.request("/api/admin/employees", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it("rejects an already-issued JWT immediately after employee archival", async () => {
    const db = makeTestDb();
    const employee = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-444" });
    linkTelegramAccount(db, "inv-444", 444);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 444);
    archiveEmployee(db, employee.id, "9999-01-01");

    const res = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
  });
});

// Тот же довод, что у /api/admin/*: оба маршрута рассылки (`POST
// /api/announcements`, `GET /api/announcements/recipients`) держат
// requireAnnouncer инлайном сегодня, но ничего не защищает третий маршрут,
// который однажды появится под этим префиксом и забудет свой гейт.
describe("blanket /api/announcements/* guard", () => {
  it("blocks a made-up announcements path for a plain worker, even with no inline guard", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-555" });
    linkTelegramAccount(db, "inv-555", 555);
    const app = createApp({ db, config });
    // A path under /api/announcements/ that has no handler: the guard must
    // still 403 (not 404) for someone who can neither admin nor announce.
    const res = await app.request("/api/announcements/does-not-exist", {
      headers: { Authorization: `Bearer ${await tokenFor(app, 555)}` },
    });
    expect(res.status).toBe(403);
  });

  it("lets an admin through to a real announcements route", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/announcements/recipients", {
      headers: { Authorization: `Bearer ${await tokenFor(app, 111)}` },
    });
    expect(res.status).toBe(200);
  });
});
