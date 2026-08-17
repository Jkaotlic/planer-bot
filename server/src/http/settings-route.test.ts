import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { createSwapRequest } from "../repo/swaps";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

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

describe("swaps lock settings", () => {
  // Two reachable people and one open request between them. On an empty database
  // `cancelled`/`delivered`/`intended` are all zero no matter what the route
  // computes, so a happy-path test against an empty db would pass even if the
  // wiring from DB state to the response body were completely broken. Named
  // "Марк Волков" rather than "Игорь Петров" for the second swap party: the
  // admin token below already claims that name, and two distinct active
  // employees sharing a display name is a state the app treats as invalid
  // everywhere else it's created through the HTTP layer.
  function seedOpenSwap(db: Db) {
    const anya = createEmployee(db, { displayName: "Аня Смирнова", inviteToken: "inv-anya" });
    linkTelegramAccount(db, "inv-anya", 1001);
    const mark = createEmployee(db, { displayName: "Марк Волков", inviteToken: "inv-mark" });
    linkTelegramAccount(db, "inv-mark", 1002);
    const anyaShift = createShift(db, { date: "2026-08-13", start: "09:00", end: "18:00", employeeId: anya.id });
    const markShift = createShift(db, { date: "2026-08-13", start: "12:00", end: "21:00", employeeId: mark.id });
    createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id,
      toEmployeeId: mark.id, toShiftId: markShift.id,
    });
  }

  const putLock = (app: ReturnType<typeof createApp>, token: string, locked: boolean) =>
    app.request("/api/admin/settings/swaps-lock", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locked }),
    });

  it("PUT /api/admin/settings/swaps-lock closes swaps and reports what it cost", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111, "Игорь Петров");
    seedOpenSwap(db);

    const res = await putLock(app, token, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.cancelled).toBe(1);
    // `intended` counts everyone the notice was addressed to. The admin who
    // pressed the button is an employee too, so this is the reachable headcount,
    // not the number of people in the swap.
    expect(body.intended).toBeGreaterThan(0);
    expect(body.delivered).toBeLessThanOrEqual(body.intended);

    const state = await app.request("/api/admin/settings", { headers: { authorization: `Bearer ${token}` } });
    expect(await state.json()).toMatchObject({ swapsLocked: true, swapsLockUpdatedBy: "Игорь Петров" });
  });

  // The other half of the pair: unlocking must report an honest zero and must
  // not reach into anybody's requests, even right after a lock that did cancel one.
  it("PUT /api/admin/settings/swaps-lock reopening cancels nothing", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111, "Игорь Петров");
    seedOpenSwap(db);

    await putLock(app, token, true);
    const res = await putLock(app, token, false);
    expect(await res.json()).toMatchObject({ locked: false, cancelled: 0 });
  });

  it("PUT /api/admin/settings/swaps-lock rejects a non-boolean body", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111, "Игорь Петров");

    const res = await app.request("/api/admin/settings/swaps-lock", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locked: "yes" }),
    });
    expect(res.status).toBe(400);
    // Pin the wording too: a refusal a person reads must stay Russian.
    expect((await res.json()).error).toBe("locked должен быть true или false");
  });

  // No standalone "GET /api/admin/settings is admin-only" test here: the whole
  // /api/admin/* prefix is closed by blanket middleware already covered by
  // server/src/http/admin-guard.test.ts. A per-route duplicate would pass even
  // with the route entirely absent — `git stash push -- server/src/http/app.ts`
  // would not turn it red — which makes it a test that cannot fail.

  it("locking writes one journal row naming what happened", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111, "Игорь Петров");
    seedOpenSwap(db);

    await putLock(app, token, true);

    const events = await (await app.request("/api/admin/journal", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(events.events[0]).toMatchObject({ type: "swaps_lock_changed" });
    expect(events.events[0].payload).toMatchObject({ locked: true, cancelled: 1 });
  });
});
