import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, getByTelegramId, reorderEmployee } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};
const configWithBotUsername: Config = { ...config, botUsername: "planer_bot" };

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}
// acceptSwap validates shift start against real wall-clock "now", so fixture dates must
// always be in the future — compute them relative to today rather than a literal date.
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
};

describe("GET /api/employees", () => {
  it("returns id+displayName for active workers and does not leak sensitive fields", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/employees", bearer(await tokenFor(app, 333)));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.employees.find((e: { id: number }) => e.id === w.id);
    expect(found).toEqual({ id: w.id, displayName: "Игорь" });
    expect(found.phone).toBeUndefined();
    expect(found.inviteToken).toBeUndefined();
    expect(found.telegramUserId).toBeUndefined();
  });

  it("rejects without a token (401)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/employees");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/employees", () => {
  it("admin creates a worker, returns an inviteToken + inviteLink, and it shows up in the admin list", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config: configWithBotUsername });
    const admin = await tokenFor(app, 111);

    const created = await app.request("/api/admin/employees", authedJson(admin, { displayName: "Марк" }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.employee.displayName).toBe("Марк");
    expect(typeof body.inviteToken).toBe("string");
    expect(body.inviteToken.length).toBeGreaterThan(0);
    expect(body.inviteLink).toBe(`https://t.me/planer_bot?start=${body.inviteToken}`);

    const list = await app.request("/api/admin/employees", bearer(admin));
    expect((await list.json()).employees.some((e: { id: number }) => e.id === body.employee.id)).toBe(true);
  });

  it("returns null inviteLink when BOT_USERNAME is not configured", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const created = await app.request("/api/admin/employees", authedJson(admin, { displayName: "Марк" }));
    expect((await created.json()).inviteLink).toBeNull();
  });

  it("rejects a worker (403) and an empty displayName (400)", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const workerToken = await tokenFor(app, 333);
    const forbidden = await app.request("/api/admin/employees", authedJson(workerToken, { displayName: "Х" }));
    expect(forbidden.status).toBe(403);

    const admin = await tokenFor(app, 111);
    const bad = await app.request("/api/admin/employees", authedJson(admin, { displayName: "" }));
    expect(bad.status).toBe(400);
    const missing = await app.request("/api/admin/employees", authedJson(admin, {}));
    expect(missing.status).toBe(400);
  });
});

describe("archive / restore employee endpoints", () => {
  it("archive removes from active lists + unassigns future shifts; restore brings back", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const future = createShift(db, { date: daysFromNow(10), start: "08:00", end: "17:00", employeeId: w.id });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const archived = await app.request(`/api/admin/employees/${w.id}/archive`, authedJson(admin, {}));
    expect(archived.status).toBe(200);
    expect((await archived.json()).ok).toBe(true);
    expect(getShift(db, future.id)?.employeeId).toBeNull();
    const afterArchive = await app.request("/api/admin/employees", bearer(admin));
    expect((await afterArchive.json()).employees.some((e: { id: number }) => e.id === w.id)).toBe(false);
    const afterArchivePublic = await app.request("/api/employees", bearer(admin));
    expect((await afterArchivePublic.json()).employees.some((e: { id: number }) => e.id === w.id)).toBe(false);

    const restored = await app.request(`/api/admin/employees/${w.id}/restore`, authedJson(admin, {}));
    expect(restored.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.isActive).toBe(true);
    const afterRestore = await app.request("/api/admin/employees", bearer(admin));
    expect((await afterRestore.json()).employees.some((e: { id: number }) => e.id === w.id)).toBe(true);
  });

  it("journals employee_archived and employee_restored with the admin as actor", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminEmployeeId = getByTelegramId(db, 111)!.id;

    await app.request(`/api/admin/employees/${w.id}/archive`, authedJson(admin, {}));
    const archivedRow = listRecentAudit(db, 5).find((a) => a.type === "employee_archived")!;
    expect(archivedRow.actorEmployeeId).toBe(adminEmployeeId);
    expect(archivedRow.payload).toMatchObject({ employeeId: w.id, displayName: "Игорь" });

    await app.request(`/api/admin/employees/${w.id}/restore`, authedJson(admin, {}));
    const restoredRow = listRecentAudit(db, 5).find((a) => a.type === "employee_restored")!;
    expect(restoredRow.actorEmployeeId).toBe(adminEmployeeId);
    expect(restoredRow.payload).toMatchObject({ employeeId: w.id, displayName: "Игорь" });
  });

  it("gates archive/restore to admins (403) and 404s an unknown id", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const workerToken = await tokenFor(app, 333);
    const admin = await tokenFor(app, 111);

    const forbiddenArchive = await app.request(`/api/admin/employees/${w.id}/archive`, authedJson(workerToken, {}));
    expect(forbiddenArchive.status).toBe(403);
    const forbiddenRestore = await app.request(`/api/admin/employees/${w.id}/restore`, authedJson(workerToken, {}));
    expect(forbiddenRestore.status).toBe(403);

    const notFoundArchive = await app.request("/api/admin/employees/999999/archive", authedJson(admin, {}));
    expect(notFoundArchive.status).toBe(404);
    const notFoundRestore = await app.request("/api/admin/employees/999999/restore", authedJson(admin, {}));
    expect(notFoundRestore.status).toBe(404);
  });

  it("refuses to archive the last active admin (400 last_admin)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);
    const admin = getByTelegramId(db, 111)!; // the sole admin

    const res = await app.request(`/api/admin/employees/${admin.id}/archive`, authedJson(adminToken, {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("last_admin");
    expect(getEmployeeById(db, admin.id)?.isActive).toBe(true);
  });

  it("still archives an admin who isn't the last one", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);
    const admin = getByTelegramId(db, 111)!;
    const w = worker(db, "Игорь", 333);
    await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: true })); // now 2 admins

    const res = await app.request(`/api/admin/employees/${w.id}/archive`, authedJson(adminToken, {}));
    expect(res.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.isActive).toBe(false);
    expect(getEmployeeById(db, admin.id)?.isActive).toBe(true); // the remaining admin is untouched
  });
});

describe("GET /api/admin/events", () => {
  it("returns recent audit rows with actorName resolved, newest-first", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Аня", 201);
    const igor = worker(db, "Игорь", 202);
    const sa = createShift(db, { date: daysFromNow(2), start: "08:00", end: "17:00", employeeId: anya.id });
    const sb = createShift(db, { date: daysFromNow(3), start: "11:00", end: "20:00", employeeId: igor.id });
    const app = createApp({ db, config });
    const anyaToken = await tokenFor(app, 201);
    const igorToken = await tokenFor(app, 202);

    const created = await app.request("/api/swaps", authedJson(anyaToken, { fromShiftId: sa.id, toShiftId: sb.id }));
    const reqId = (await created.json()).request.id as number;
    const accepted = await app.request(`/api/swaps/${reqId}/accept`, authedJson(igorToken, {}));
    expect(accepted.status).toBe(200);

    const admin = await tokenFor(app, 111);
    const events = await app.request("/api/admin/events", bearer(admin));
    expect(events.status).toBe(200);
    const body = await events.json();
    expect(body.events.length).toBeGreaterThan(0);
    const swapAccepted = body.events.find((e: { type: string }) => e.type === "swap_accepted");
    expect(swapAccepted).toBeDefined();
    expect(swapAccepted.actorName).toBe("Игорь");
    // newest-first
    const timestamps = body.events.map((e: { createdAt: string | number }) => new Date(e.createdAt).getTime());
    expect([...timestamps]).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("gates events to admins (403)", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const workerToken = await tokenFor(app, 333);
    const res = await app.request("/api/admin/events", bearer(workerToken));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/employees/:id/role", () => {
  it("promotes a worker to admin and back", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111); // 111 ∈ adminTelegramIds → admin employee

    const up = await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: true }));
    expect(up.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.isAdmin).toBe(true);

    const down = await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: false }));
    expect(down.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.isAdmin).toBe(false);
  });

  it("journals employee_admin_changed, actored by the granting admin, for both grant and revoke", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);
    const adminEmployeeId = getByTelegramId(db, 111)!.id;

    await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: true }));
    const granted = listRecentAudit(db, 5).find((a) => a.type === "employee_admin_changed")!;
    expect(granted.actorEmployeeId).toBe(adminEmployeeId);
    expect(granted.payload).toMatchObject({ employeeId: w.id, displayName: "Игорь", isAdmin: true });

    await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: false }));
    const revoked = listRecentAudit(db, 5).find((a) => a.type === "employee_admin_changed" && (a.payload as { isAdmin: boolean }).isAdmin === false)!;
    expect(revoked.actorEmployeeId).toBe(adminEmployeeId);
    expect(revoked.payload).toMatchObject({ employeeId: w.id, displayName: "Игорь", isAdmin: false });
  });

  it("refuses to demote the last admin (400 last_admin)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);
    const admin = getByTelegramId(db, 111)!; // the sole admin
    const res = await app.request(`/api/admin/employees/${admin.id}/role`, authedJson(adminToken, { isAdmin: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("last_admin");
    expect(getEmployeeById(db, admin.id)?.isAdmin).toBe(true);
  });

  it("rejects a worker calling it (403)", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(`/api/admin/employees/${w.id}/role`, authedJson(await tokenFor(app, 333), { isAdmin: true }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/employees/:id/invite", () => {
  it("re-issues the invite link for an unlinked worker (and can regenerate)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Настя", inviteToken: "orig-token" }); // unlinked
    const app = createApp({ db, config: configWithBotUsername });
    const token = await tokenFor(app, 111);

    const first = await app.request(`/api/admin/employees/${w.id}/invite`, authedJson(token, {}));
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1.inviteToken).toBe("orig-token"); // reuses existing
    expect(b1.inviteLink).toBe("https://t.me/planer_bot?start=orig-token");

    const regen = await app.request(`/api/admin/employees/${w.id}/invite`, authedJson(token, { regenerate: true }));
    const b2 = await regen.json();
    expect(b2.inviteToken).not.toBe("orig-token"); // fresh token
    expect(getEmployeeById(db, w.id)?.inviteToken).toBe(b2.inviteToken);
  });

  it("refuses for an already-linked worker (400)", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333); // linked
    const app = createApp({ db, config: configWithBotUsername });
    const res = await app.request(`/api/admin/employees/${w.id}/invite`, authedJson(await tokenFor(app, 111), {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("already_linked");
  });
});

describe("PATCH /api/admin/employees/:id (rename)", () => {
  it("renames a worker", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(`/api/admin/employees/${w.id}`, authedJson(await tokenFor(app, 111), { displayName: "  Игорь Петров  " }, "PATCH"));
    expect(res.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.displayName).toBe("Игорь Петров"); // trimmed
  });

  it("rejects a blank name (400) and a worker caller (403)", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const blank = await app.request(`/api/admin/employees/${w.id}`, authedJson(await tokenFor(app, 111), { displayName: "   " }, "PATCH"));
    expect(blank.status).toBe(400);
    const forbidden = await app.request(`/api/admin/employees/${w.id}`, authedJson(await tokenFor(app, 333), { displayName: "X" }, "PATCH"));
    expect(forbidden.status).toBe(403);
  });
});

describe("worker order", () => {
  it("moves a worker, renumbers the rest and records who did it", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const ids = ["Первый", "Второй", "Третий"].map((displayName) => createEmployee(db, { displayName }).id);
    ids.forEach((id, index) => reorderEmployee(db, id, index + 1));

    const res = await app.request(`/api/admin/employees/${ids[2]}/order`, authedJson(admin, { position: 1 }));
    expect(res.status).toBe(200);
    // The allowlisted admin auto-registers on first auth, so they are in the list
    // too — the numbering below is over everyone, which is the point of renumbering.
    const { employees } = await res.json();
    const named = (list: { displayName: string }[]) =>
      list.map((e) => e.displayName).filter((n) => n !== "T");
    expect(named(employees)).toEqual(["Третий", "Первый", "Второй"]);
    expect(employees.map((e: { rosterOrder: number }) => e.rosterOrder)).toEqual([0, 1, 2, 3]);

    // The listing every screen reads must agree with what the move returned.
    const listed = await (await app.request("/api/admin/employees", { headers: { Authorization: `Bearer ${admin}` } })).json();
    expect(named(listed.employees)).toEqual(["Третий", "Первый", "Второй"]);

    const moved = listRecentAudit(db, 5).find((a) => a.type === "employee_reordered")!;
    expect(moved.payload).toMatchObject({ employeeId: ids[2], displayName: "Третий", to: 0 });
  });

  it("rejects a missing or non-numeric position, and an unknown worker", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Один" }).id;

    expect((await app.request(`/api/admin/employees/${id}/order`, authedJson(admin, {}))).status).toBe(400);
    expect((await app.request(`/api/admin/employees/${id}/order`, authedJson(admin, { position: "первый" }))).status).toBe(400);
    expect((await app.request("/api/admin/employees/9999/order", authedJson(admin, { position: 1 }))).status).toBe(404);
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const worker = createEmployee(db, { displayName: "Работник", inviteToken: "inv-9" });
    linkTelegramAccount(db, "inv-9", 444);
    const res = await app.request(`/api/admin/employees/${worker.id}/order`, authedJson(await tokenFor(app, 444), { position: 1 }));
    expect(res.status).toBe(403);
  });
});

describe("birthdays", () => {
  it("stores a birthday as day and month, with no year to invent", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Именинник" }).id;

    const res = await app.request(`/api/admin/employees/${id}`, authedJson(admin, { birthDate: "05-08" }, "PATCH"));
    expect(res.status).toBe(200);
    expect((await res.json()).employee).toMatchObject({ birthDate: "05-08", displayName: "Именинник" });
    expect(getEmployeeById(db, id)!.birthDate).toBe("05-08");
  });

  it("sets a name and a birthday in one edit", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Старое Имя" }).id;

    await app.request(`/api/admin/employees/${id}`, authedJson(admin, { displayName: "Новое Имя", birthDate: "12-31" }, "PATCH"));
    expect(getEmployeeById(db, id)).toMatchObject({ displayName: "Новое Имя", birthDate: "12-31" });
  });

  it("clears a birthday with null — nobody is obliged to give one", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Скрытный" }).id;

    await app.request(`/api/admin/employees/${id}`, authedJson(admin, { birthDate: "05-08" }, "PATCH"));
    await app.request(`/api/admin/employees/${id}`, authedJson(admin, { birthDate: null }, "PATCH"));
    expect(getEmployeeById(db, id)!.birthDate).toBeNull();
  });

  it("refuses a day that month hasn't got, and anything not ММ-ДД", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Кто-то" }).id;

    for (const bad of ["02-30", "13-01", "2026-05-08", "8-5", "05.08", ""]) {
      const res = await app.request(`/api/admin/employees/${id}`, authedJson(admin, { birthDate: bad }, "PATCH"));
      expect(res.status, `«${bad}» must be rejected`).toBe(400);
    }
    expect(getEmployeeById(db, id)!.birthDate).toBeNull();
  });

  it("accepts 29 February", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Високосный" }).id;
    const res = await app.request(`/api/admin/employees/${id}`, authedJson(admin, { birthDate: "02-29" }, "PATCH"));
    expect(res.status).toBe(200);
  });

  it("still refuses an edit that changes nothing at all", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const id = createEmployee(db, { displayName: "Кто-то" }).id;
    expect((await app.request(`/api/admin/employees/${id}`, authedJson(admin, {}, "PATCH"))).status).toBe(400);
  });
});

describe("preferred name", () => {
  it("greets by the chosen name, over Telegram's and over the roster's", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 901);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 901);

    const before = await (await app.request("/api/me", bearer(token))).json();
    // `/api/auth` refreshes tgFirstName from the signed initData, which carries "T".
    expect(before.address).toBe("T");
    expect(before.preferredName).toBeNull();

    const saved = await app.request("/api/me/settings", authedJson(token, { preferredName: " Андрей " }, "PATCH"));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ preferredName: "Андрей", address: "Андрей" });

    const after = await (await app.request("/api/me", bearer(token))).json();
    expect(after.address).toBe("Андрей");
    expect(after.displayName).toBe("Петров Алексей"); // lists are untouched
  });

  it("accepts each settings field on its own — the route is a patch, not a form", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 902);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 902);

    const onlyReminders = await app.request("/api/me/settings", authedJson(token, { remindersEnabled: false }, "PATCH"));
    expect(onlyReminders.status).toBe(200);
    expect(await onlyReminders.json()).toMatchObject({ remindersEnabled: false });

    const onlyName = await app.request("/api/me/settings", authedJson(token, { preferredName: "Андрей" }, "PATCH"));
    expect(onlyName.status).toBe(200);
    // Setting one must not quietly reset the other.
    expect(await onlyName.json()).toMatchObject({ remindersEnabled: false, preferredName: "Андрей" });
  });

  it("clears the name on blank, and refuses an over-long one", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 903);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 903);

    await app.request("/api/me/settings", authedJson(token, { preferredName: "Андрей" }, "PATCH"));
    const cleared = await app.request("/api/me/settings", authedJson(token, { preferredName: "  " }, "PATCH"));
    expect(await cleared.json()).toMatchObject({ preferredName: null });

    const tooLong = await app.request("/api/me/settings", authedJson(token, { preferredName: "я".repeat(65) }, "PATCH"));
    expect(tooLong.status).toBe(400);
  });

  it("rejects an empty settings body", async () => {
    const db = makeTestDb();
    worker(db, "Петров Алексей", 904);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 904);
    expect((await app.request("/api/me/settings", authedJson(token, {}, "PATCH"))).status).toBe(400);
  });

  it("lets an admin set it for somebody who never will", async () => {
    // The case this exists for: workers linked before tgFirstName was stored have
    // nothing to fall back to but «Кузнецов Михаил».
    const db = makeTestDb();
    const mike = worker(db, "Кузнецов Михаил", 906);
    const app = createApp({ db, config });
    // 111 is in `config.adminTelegramIds`, so authing as it yields an admin token —
    // the same way every other admin test in this file gets one.
    const admin = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/employees/${mike.id}`, authedJson(admin, { preferredName: "Михаил" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(getEmployeeById(db, mike.id)!.preferredName).toBe("Михаил");

    const { employees } = await (await app.request("/api/admin/employees", bearer(admin))).json();
    expect(employees.find((e: { id: number }) => e.id === mike.id).address).toBe("Михаил");
    expect(listRecentAudit(db, 10).some((row) => row.type === "employee_updated")).toBe(true);
  });
});
