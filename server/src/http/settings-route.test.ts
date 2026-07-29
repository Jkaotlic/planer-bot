import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

const initDataFor = (id: number, firstName = "T") =>
  signInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: firstName }) },
    config.botToken,
  );

const tokenFor = async (app: ReturnType<typeof createApp>, id: number, firstName = "T") =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id, firstName) }),
  }))).json()).token as string;

const patch = (token: string, body: unknown) => ({
  method: "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("GET /api/me", () => {
  it("hands back an address that is not the roster's first word", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Петров Алексей", inviteToken: "inv" });
    linkTelegramAccount(db, "inv", 555, "andrey", "Андрей");

    const token = await tokenFor(app, 555, "Андрей");
    const me = await (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(me.address).toBe("Андрей");
    // The roster name is still there — lists and exports need «Фамилия Имя».
    expect(me.displayName).toBe("Петров Алексей");
    expect(me.remindersEnabled).toBe(true);
  });

  it("falls back to the full name when Telegram gave us nothing to go on", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Петров Алексей", inviteToken: "inv" });
    linkTelegramAccount(db, "inv", 556);

    // Auth refreshes the profile from initData, so pass a blank first_name to
    // model the case where there is genuinely nothing to address them by.
    const token = await tokenFor(app, 556, "");
    const me = await (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(me.address).toBe("Петров Алексей");
  });

  it("keeps the greeting current when somebody renames themselves in Telegram", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Петров Алексей", inviteToken: "inv" });
    linkTelegramAccount(db, "inv", 557, "andrey", "Андрей");

    const token = await tokenFor(app, 557, "Дюша");
    const me = await (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(me.address).toBe("Дюша");
  });
});

describe("PATCH /api/me/settings", () => {
  async function worker(app: ReturnType<typeof createApp>, db: ReturnType<typeof makeTestDb>, tgId: number) {
    const employee = createEmployee(db, { displayName: `Работник ${tgId}`, inviteToken: `inv-${tgId}` });
    linkTelegramAccount(db, `inv-${tgId}`, tgId);
    return { employee, token: await tokenFor(app, tgId) };
  }

  it("lets a worker turn their own reminders off and back on", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const { employee, token } = await worker(app, db, 222);

    const off = await app.request("/api/me/settings", patch(token, { remindersEnabled: false }));
    expect(off.status).toBe(200);
    // Task 2 widened this response to carry `preferredName`/`address` too, so the
    // greeting can update without a second round trip — see PATCH /api/me/settings.
    expect(await off.json()).toEqual({ remindersEnabled: false, preferredName: null, address: "T" });
    expect(getEmployeeById(db, employee.id)!.remindersEnabled).toBe(false);

    await app.request("/api/me/settings", patch(token, { remindersEnabled: true }));
    expect(getEmployeeById(db, employee.id)!.remindersEnabled).toBe(true);
  });

  it("is not an admin power — a plain worker owns this switch", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const { token } = await worker(app, db, 223);
    expect((await app.request("/api/me/settings", patch(token, { remindersEnabled: false }))).status).toBe(200);
  });

  it("touches only the caller — there is no id to point at anybody else", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const me = await worker(app, db, 224);
    const colleague = await worker(app, db, 225);

    await app.request("/api/me/settings", patch(me.token, { remindersEnabled: false }));

    expect(getEmployeeById(db, me.employee.id)!.remindersEnabled).toBe(false);
    expect(getEmployeeById(db, colleague.employee.id)!.remindersEnabled).toBe(true);
  });

  it("refuses anything that isn't a boolean rather than guessing", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const { employee, token } = await worker(app, db, 226);

    for (const body of [{}, { remindersEnabled: "false" }, { remindersEnabled: 0 }, { remindersEnabled: null }]) {
      expect((await app.request("/api/me/settings", patch(token, body))).status, JSON.stringify(body)).toBe(400);
    }
    // «false» as a string is the dangerous one: treated as truthy it would turn
    // reminders back ON for somebody who just asked for silence.
    expect(getEmployeeById(db, employee.id)!.remindersEnabled).toBe(true);
  });

  it("needs a token at all", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/me/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ remindersEnabled: false }),
    });
    expect(res.status).toBe(401);
  });
});
