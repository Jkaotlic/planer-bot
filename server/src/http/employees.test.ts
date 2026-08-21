import { describe, it, expect } from "vitest";
import { recordApi, stubBotInfo } from "../bot/testbot";
import { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, getEmployeeById, getByTelegramId, listForAdmin, reorderEmployee, archiveEmployee, setEmployeeAdmin, setEmployeeObserver } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { createSwapRequest, getSwapRequest } from "../repo/swaps";
import { listRecentAudit, recordAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";
import { adminEmployeeSchema, adminEmployeesResponseSchema, employeesResponseSchema } from "@planer/shared";

const config = testConfig();
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

/** A bot whose `sendMessage` calls land in `sent` instead of hitting the network —
 *  same shape as `swaps.test.ts`'s helper, needed here to prove which restriction
 *  flag talks to people and which stays silent. */
function testBot() {
  const bot = stubBotInfo(new Bot("12345:tok"), { id: 1, first_name: "P", username: "p_bot" });
  const { sent } = recordApi(bot);
  return { bot, sent };
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

  it("создание работника попадает в журнал", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request("/api/admin/employees", authedJson(admin, { displayName: "Света Орлова" }));

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_created");
    expect((event?.payload as { displayName: string }).displayName).toBe("Света Орлова");
  });
});

// The roster CSV is keyed by ФИО and nothing else: two active namesakes make the
// export write two identical rows, and the import then refuses the whole file with
// «в CSV повторяется ФИО» — the график-файлом feature dies, and the message blames
// the file. He says the team has no namesakes, so the three doors say so too.
describe("ФИО среди активных — одно на одного", () => {
  it("refuses to create a second active worker with the same name", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const dupe = await app.request("/api/admin/employees", authedJson(admin, { displayName: "  Иванов Иван " }));
    expect(dupe.status).toBe(409);
    expect((await dupe.json()).error).toMatch(/Иванов Иван/);
    expect((await (await app.request("/api/admin/employees", bearer(admin))).json()).employees).toHaveLength(2); // admin + the one
  });

  it("compares case-insensitively — a namesake in lower case is still a namesake", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    expect((await app.request("/api/admin/employees", authedJson(admin, { displayName: "иванов иван" }))).status).toBe(409);
  });

  it("lets an archived namesake exist — the export writes no row for them", async () => {
    const db = makeTestDb();
    const gone = createEmployee(db, { displayName: "Иванов Иван" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    await app.request(`/api/admin/employees/${gone.id}/archive`, authedJson(admin, {}));

    expect((await app.request("/api/admin/employees", authedJson(admin, { displayName: "Иванов Иван" }))).status).toBe(201);
  });

  it("refuses a rename onto somebody else's name, but allows re-saving your own", async () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });
    const me = createEmployee(db, { displayName: "Петров Пётр" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const clash = await app.request(`/api/admin/employees/${me.id}`, authedJson(admin, { displayName: "Иванов Иван" }, "PATCH"));
    expect(clash.status).toBe(409);
    expect(getEmployeeById(db, me.id)!.displayName).toBe("Петров Пётр");

    const same = await app.request(`/api/admin/employees/${me.id}`, authedJson(admin, { displayName: "Петров Пётр" }, "PATCH"));
    expect(same.status).toBe(200);
  });

  it("refuses to restore an archived worker whose name is taken now", async () => {
    const db = makeTestDb();
    const gone = createEmployee(db, { displayName: "Иванов Иван" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    await app.request(`/api/admin/employees/${gone.id}/archive`, authedJson(admin, {}));
    await app.request("/api/admin/employees", authedJson(admin, { displayName: "Иванов Иван" }));

    const restored = await app.request(`/api/admin/employees/${gone.id}/restore`, authedJson(admin, {}));
    expect(restored.status).toBe(409);
    expect((await restored.json()).error).toMatch(/Иванов Иван/);
    expect(getEmployeeById(db, gone.id)!.isActive).toBe(false);
  });
});

describe("invite links", () => {
  // `linkTelegramAccount` refuses archived rows, so a link for one can only ever
  // answer «ссылка недействительна». Say so here instead of minting it.
  it("refuses to mint an invite for an archived worker (400)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь Петров" });
    const app = createApp({ db, config: configWithBotUsername });
    const admin = await tokenFor(app, 111);

    const before = await app.request(`/api/admin/employees/${w.id}/invite`, authedJson(admin, {}));
    expect(before.status).toBe(200);

    await app.request(`/api/admin/employees/${w.id}/archive`, authedJson(admin, {}));
    const after = await app.request(`/api/admin/employees/${w.id}/invite`, authedJson(admin, {}));
    expect(after.status).toBe(400);
    expect((await after.json()).error).toBe("archived");
  });

  it("выдача приглашения попадает в журнал, но без самого токена", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config: configWithBotUsername });
    const admin = await tokenFor(app, 111);
    const created = await (await app.request("/api/admin/employees", authedJson(admin, { displayName: "Света Орлова" }))).json();

    const res = await app.request(`/api/admin/employees/${created.employee.id}/invite`, authedJson(admin, { regenerate: true }));
    const { inviteToken } = await res.json();

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_invite_issued");
    expect((event?.payload as { regenerated: boolean }).regenerated).toBe(true);
    // Ключ к учётной записи в журнал не попадает — его видят все админы.
    expect(JSON.stringify(event?.payload)).not.toContain(inviteToken);
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
    // The admin roster is the one list that has to keep showing them — it is what
    // draws the «Архив» tab and its «Восстановить» button. Everywhere else they're gone.
    const afterArchive = await app.request("/api/admin/employees", bearer(admin));
    const archivedRow = (await afterArchive.json()).employees.find((e: { id: number }) => e.id === w.id);
    expect(archivedRow).toBeDefined();
    expect(archivedRow.isActive).toBe(false);
    const afterArchivePublic = await app.request("/api/employees", bearer(admin));
    expect((await afterArchivePublic.json()).employees.some((e: { id: number }) => e.id === w.id)).toBe(false);

    const restored = await app.request(`/api/admin/employees/${w.id}/restore`, authedJson(admin, {}));
    expect(restored.status).toBe(200);
    expect(getEmployeeById(db, w.id)?.isActive).toBe(true);
    const afterRestore = await app.request("/api/admin/employees", bearer(admin));
    expect((await afterRestore.json()).employees.some((e: { id: number }) => e.id === w.id)).toBe(true);
  });

  // Both consoles build their «Архив» tab by filtering this one list for
  // `isActive === false`. Serving only the active ones left that tab permanently
  // empty and «Восстановить» unreachable — archiving was a one-way door.
  it("GET /api/admin/employees lists archived workers after the active ones", async () => {
    const db = makeTestDb();
    const first = worker(db, "Первый Работник", 331);
    const second = worker(db, "Второй Работник", 332);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request(`/api/admin/employees/${second.id}/archive`, authedJson(admin, {}));
    const list = (await (await app.request("/api/admin/employees", bearer(admin))).json())
      .employees as { id: number; isActive: boolean }[];

    expect(list.filter((e) => e.id === second.id)).toHaveLength(1);
    expect(list.find((e) => e.id === second.id)!.isActive).toBe(false);
    // Active first, archive at the bottom — the screen renders in the order it gets.
    expect(list.findIndex((e) => e.id === first.id)).toBeLessThan(list.findIndex((e) => e.id === second.id));
    expect(list.at(-1)!.id).toBe(second.id);
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
    // Тот же день, что и у Ани: меняться можно только внутри одного дня.
    const sb = createShift(db, { date: daysFromNow(2), start: "11:00", end: "20:00", employeeId: igor.id });
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

  // Правило сюрприза применяется и здесь, а не только в журнале: лента справа
  // читается тем же админом на том же экране, и сбор на него самого рассказывал
  // ему про его же подарок.
  it("withholds collection events about the viewer (the surprise rule)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);
    const admin = getByTelegramId(db, 111)!;
    const igor = worker(db, "Игорь", 333);

    recordAudit(db, "collection_sent", igor.id, { employeeId: admin.id, title: "Свадьба", delivered: 5, intended: 6 });
    recordAudit(db, "collection_sent", igor.id, { employeeId: igor.id, title: "Юбилей", delivered: 5, intended: 6 });

    const body = await (await app.request("/api/admin/events", bearer(adminToken))).json();
    const titles = body.events.map((e: { payload: { title?: string } }) => e.payload?.title);
    expect(titles).toContain("Юбилей");
    expect(titles).not.toContain("Свадьба");
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

  // Тот же guard, что уже стоит у записей и распределения (archivedTargetError):
  // с архивным целевым человеком ничего не делаем, а не отвечаем ему левой
  // причиной. Раньше промоут архивного в админы проходил безусловно — запись
  // в никуда, войти он всё равно не мог (403 на requireAdmin по isActive), но
  // правило «архивного не трогаем» было закрыто везде, кроме этой двери.
  it("отказывает промоутить архивного, а не пишет права в никуда", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    archiveEmployee(db, w.id, "2026-01-01");
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: true }));
    expect(res.status).toBe(400);
    expect(getEmployeeById(db, w.id)?.isAdmin).toBe(false);
  });

  // Демоут архивного админа раньше упирался в last_admin по чужой причине:
  // countActiveAdmins не считает архивных, так что реального «последнего
  // активного админа» никто бы не остался без прав. Архивная проверка теперь
  // стоит раньше и называет настоящую причину.
  it("отказывает демоутить архивного по правильной причине, не last_admin", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь", 333);
    setEmployeeAdmin(db, w.id, true);
    archiveEmployee(db, w.id, "2026-01-01");
    const app = createApp({ db, config });
    const adminToken = await tokenFor(app, 111); // остаётся активным админом — last_admin тут ни при чём

    const res = await app.request(`/api/admin/employees/${w.id}/role`, authedJson(adminToken, { isAdmin: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toBe("last_admin");
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

  it("переименование сохраняет в журнале и старое имя, и новое", async () => {
    const db = makeTestDb();
    const sveta = worker(db, "Света Орлов", 201);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    await app.request(`/api/admin/employees/${sveta.id}`, authedJson(admin, { displayName: "Света Орлова" }, "PATCH"));

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_updated");
    const payload = event?.payload as { before: { displayName: string }; after: { displayName: string } };
    expect(payload.before.displayName).toBe("Света Орлов");
    expect(payload.after.displayName).toBe("Света Орлова");
  });
});

describe("PATCH /api/admin/employees/:id (restriction flags)", () => {
  it("PATCH accepts both restriction flags and reports them back", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь Петров", 202);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request(
      `/api/admin/employees/${w.id}`,
      authedJson(admin, { excludedFromAssignment: true, excludedFromSwaps: true }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.excludedFromAssignment).toBe(true);
    expect(body.employee.excludedFromSwaps).toBe(true);
    expect(getEmployeeById(db, w.id)).toMatchObject({ excludedFromAssignment: true, excludedFromSwaps: true });
  });

  it("PATCH rejects a non-boolean restriction flag", async () => {
    const db = makeTestDb();
    const w = worker(db, "Игорь Петров", 202);
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/employees/${w.id}`, authedJson(admin, { excludedFromSwaps: "yes" }, "PATCH"));
    expect(res.status).toBe(400);
    // Pin the wording: a body with only this field present must be refused for
    // failing its own boolean check, not fall through to the unrelated
    // "displayName is required" guard that fires when nothing valid is present.
    expect((await res.json()).error).toBe("excludedFromSwaps должен быть true или false");
    expect(getEmployeeById(db, w.id)!.excludedFromSwaps).toBe(false); // rejected, not half-applied
  });

  // Cancelling is the point: the counterparty is holding chat buttons whose only
  // possible answer would now be an error.
  it("closing a person's swaps cancels their open requests in both directions", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201); // the person being excluded
    const igor = worker(db, "Игорь Петров", 202); // counterparty on Anya's outgoing request
    const mark = worker(db, "Марк Волков", 203); // initiator of Anya's incoming request
    const bystanderA = worker(db, "Первый Работник", 204); // unrelated pair — must survive
    const bystanderB = worker(db, "Второй Работник", 205);

    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    const markShift = createShift(db, { date: daysFromNow(4), start: "10:00", end: "19:00", employeeId: mark.id });
    const anyaShift2 = createShift(db, { date: daysFromNow(4), start: "11:00", end: "20:00", employeeId: anya.id });
    const bystanderAShift = createShift(db, { date: daysFromNow(5), start: "08:00", end: "17:00", employeeId: bystanderA.id });
    const bystanderBShift = createShift(db, { date: daysFromNow(5), start: "09:00", end: "18:00", employeeId: bystanderB.id });

    // Anya's outgoing: she proposed trading her shift for Igor's.
    const outgoing = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    // Anya's incoming: Mark proposed trading his shift for Anya's other one.
    const incoming = createSwapRequest(db, {
      fromEmployeeId: mark.id, fromShiftId: markShift.id, toEmployeeId: anya.id, toShiftId: anyaShift2.id,
    });
    // Nothing to do with Anya — must stay pending.
    const unrelated = createSwapRequest(db, {
      fromEmployeeId: bystanderA.id, fromShiftId: bystanderAShift.id, toEmployeeId: bystanderB.id, toShiftId: bystanderBShift.id,
    });

    const res = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { excludedFromSwaps: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, outgoing.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, incoming.id)?.status).toBe("cancelled");
    expect(getSwapRequest(db, unrelated.id)?.status).toBe("pending");
  });

  // Paired: the flag alone is what cancels, so clearing it must not.
  it("clearing the flag cancels nothing", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201);
    const igor = worker(db, "Игорь Петров", 202);
    const bystanderA = worker(db, "Первый Работник", 204);
    const bystanderB = worker(db, "Второй Работник", 205);

    // Excluded first, with nothing pending yet — this PATCH itself cancels nothing.
    const setup = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { excludedFromSwaps: true }, "PATCH"));
    expect(setup.status).toBe(200);

    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    const bystanderAShift = createShift(db, { date: daysFromNow(4), start: "08:00", end: "17:00", employeeId: bystanderA.id });
    const bystanderBShift = createShift(db, { date: daysFromNow(4), start: "09:00", end: "18:00", employeeId: bystanderB.id });
    // Seeded directly (bypassing whatever Task 11 will do at creation time) so
    // this test only exercises the PATCH route's own cancellation logic.
    const anyaOwn = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });
    const unrelated = createSwapRequest(db, {
      fromEmployeeId: bystanderA.id, fromShiftId: bystanderAShift.id, toEmployeeId: bystanderB.id, toShiftId: bystanderBShift.id,
    });

    const res = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { excludedFromSwaps: false }, "PATCH"));
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, anyaOwn.id)?.status).toBe("pending");
    expect(getSwapRequest(db, unrelated.id)?.status).toBe("pending");
  });

  it("a PATCH that does not touch the flags writes no restrictions journal row", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = worker(db, "Аня Смирнова", 201);

    // Give the flags a real, non-default state first, so "unchanged by the rename"
    // below is a fact about a genuine prior write, not just the schema default.
    const seeded = await app.request(`/api/admin/employees/${w.id}`, authedJson(admin, { excludedFromAssignment: true }, "PATCH"));
    expect(seeded.status).toBe(200);

    const renamed = await app.request(`/api/admin/employees/${w.id}`, authedJson(admin, { displayName: "Аня Смирнова" }, "PATCH"));
    expect(renamed.status).toBe(200);

    // Exactly one restrictions row — from the seeding PATCH. The rename-only
    // PATCH must not have added a second one.
    const restrictionsRows = listRecentAudit(db, 20).filter((row) => row.type === "employee_restrictions_changed");
    expect(restrictionsRows).toHaveLength(1);
  });

  /**
   * The assignment flag is deliberately silent.
   *
   * A worker cannot see how the bot hands shifts out, so «тебя исключили из
   * назначений» would tell them about machinery they never knew existed and start
   * a conversation the admin did not ask for. The flag leaves a journal row and
   * nothing else. Without this test the notification would arrive the first time
   * somebody «tidied up» the route by treating both flags the same way.
   */
  it("the assignment flag notifies nobody", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const w = worker(db, "Игорь Петров", 202);

    const res = await app.request(`/api/admin/employees/${w.id}`, authedJson(admin, { excludedFromAssignment: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(sent).toHaveLength(0);
    const journaled = listRecentAudit(db, 20).find((row) => row.type === "employee_restrictions_changed");
    expect(journaled).toBeDefined();
    expect((journaled?.payload as { after: { excludedFromAssignment: boolean } }).after.excludedFromAssignment).toBe(true);
  });

  // Paired with the test above: the swaps flag is the one that talks.
  it("the swaps flag does notify the person", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const w = worker(db, "Аня Смирнова", 201);

    const res = await app.request(`/api/admin/employees/${w.id}`, authedJson(admin, { excludedFromSwaps: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(sent.some((s) => s.chat_id === 201)).toBe(true);
  });

  // The two journal rows are independent facts about one action: renaming
  // somebody while also flipping a flag is a single admin gesture, but it is
  // "changed the name" AND "changed a restriction" — both belong in the log.
  it("a PATCH that renames AND flips a flag writes both journal rows", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = worker(db, "Кто-то", 203);

    const res = await app.request(
      `/api/admin/employees/${w.id}`,
      authedJson(admin, { displayName: "Кто-то Другой", excludedFromSwaps: true }, "PATCH"),
    );
    expect(res.status).toBe(200);

    const recent = listRecentAudit(db, 20);
    expect(recent.some((row) => row.type === "employee_updated")).toBe(true);
    expect(recent.some((row) => row.type === "employee_restrictions_changed")).toBe(true);
  });
});

describe("PATCH /api/admin/employees/:id (роль наблюдателя)", () => {
  it("админ включает и снимает роль наблюдателя", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const target = worker(db, "Игорь", 333);

    const on = await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: true }, "PATCH"));
    expect(on.status).toBe(200);
    expect((await on.json()).employee.isObserver).toBe(true);
    expect(getEmployeeById(db, target.id)!.isObserver).toBe(true);

    const off = await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: false }, "PATCH"));
    expect(off.status).toBe(200);
    expect((await off.json()).employee.isObserver).toBe(false);
    expect(getEmployeeById(db, target.id)!.isObserver).toBe(false);
  });

  // Тот же запрос от админа проходит (тест выше) — 403 здесь именно про право,
  // а не про какую-то другую причину отказа.
  it("работник не может выдать себе роль", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const me = worker(db, "Марк", 643);

    const res = await app.request(`/api/admin/employees/${me.id}`, authedJson(await tokenFor(app, 643), { isObserver: true }, "PATCH"));
    expect(res.status).toBe(403);
    expect(getEmployeeById(db, me.id)!.isObserver).toBe(false);
  });

  it("PATCH отклоняет нелогическое значение isObserver", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const target = worker(db, "Игорь", 333);

    const res = await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: "yes" }, "PATCH"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("isObserver должен быть true или false");
    expect(getEmployeeById(db, target.id)!.isObserver).toBe(false);
  });

  it("смена роли попадает в журнал рядом с восстановлением ограничений", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminEmployeeId = getByTelegramId(db, 111)!.id;
    const target = worker(db, "Игорь", 333);

    await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: true }, "PATCH"));

    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_observer_changed");
    expect(event?.actorEmployeeId).toBe(adminEmployeeId);
    expect(event?.payload).toMatchObject({ employeeId: target.id, displayName: "Игорь", before: false, after: true });
  });

  // Осознанное решение из брифа: снятие роли не должно переписывать
  // исключения — админ должен видеть, куда человек вернётся.
  it("снятие роли не трогает исключения из назначений/обменов", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const target = worker(db, "Игорь", 333);
    await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { excludedFromAssignment: true }, "PATCH"));

    await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: true }, "PATCH"));
    await app.request(`/api/admin/employees/${target.id}`, authedJson(admin, { isObserver: false }, "PATCH"));

    expect(getEmployeeById(db, target.id)!.excludedFromAssignment).toBe(true);
  });
});

// Роль «Наблюдатель» значит «вне обменов» ровно тем же гейтом, что и
// `excludedFromSwaps` (`canSwap` в shared/src/access.ts): выдача роли обязана
// гасить открытые заявки этого человека тем же путём, что и поднятая
// галочка — иначе заявка остаётся в базе живой, а принять её не может уже
// ни одна сторона (наблюдателю запрещает роль, а встречную сторону саму
// никто не спрашивал).
describe("PATCH /api/admin/employees/:id (роль наблюдателя гасит открытые обмены)", () => {
  it("выдача роли гасит висящую заявку — обеим сторонам письмо, в журнале запись", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201);
    const igor = worker(db, "Игорь Петров", 202);
    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    const swap = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const res = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { isObserver: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, swap.id)?.status).toBe("cancelled");
    expect(sent.some((s) => s.chat_id === 201)).toBe(true); // Ане — «тебе закрыли обмены»
    expect(sent.some((s) => s.chat_id === 202)).toBe(true); // Игорю — что его заявка отменена
    const event = listRecentAudit(db, 10).find((row) => row.type === "employee_observer_changed");
    expect(event?.payload).toMatchObject({ employeeId: anya.id, before: false, after: true });
  });

  // Парный: тот же расклад, но PATCH не трогает роль — заявка не гаснет.
  it("PATCH другого поля ту же заявку не трогает", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201);
    const igor = worker(db, "Игорь Петров", 202);
    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    const swap = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const res = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { excludedFromAssignment: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, swap.id)?.status).toBe("pending");
    expect(sent).toHaveLength(0);
  });

  it("повторный PATCH isObserver:true на уже наблюдателе не гасит и не шлёт писем", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201);
    const igor = worker(db, "Игорь Петров", 202);
    setEmployeeObserver(db, anya.id, true); // уже наблюдатель ДО этой заявки
    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    // Заявка заведена напрямую через репозиторий (как и в соседних тестах
    // файла) — сервис создания обмена наблюдателю такое не разрешил бы, а
    // здесь нужна ЗАВИСШАЯ заявка независимо от пути её появления.
    const swap = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const res = await app.request(`/api/admin/employees/${anya.id}`, authedJson(admin, { isObserver: true }, "PATCH"));
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, swap.id)?.status).toBe("pending"); // доступ не менялся — гасить нечего
    expect(sent).toHaveLength(0);
  });

  it("одновременная выдача роли и галочки гасит заявку один раз (по числу писем)", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot();
    const app = createApp({ db, config, bot });
    const admin = await tokenFor(app, 111);
    const anya = worker(db, "Аня Смирнова", 201);
    const igor = worker(db, "Игорь Петров", 202);
    const anyaShift = createShift(db, { date: daysFromNow(3), start: "08:00", end: "17:00", employeeId: anya.id });
    const igorShift = createShift(db, { date: daysFromNow(3), start: "09:00", end: "18:00", employeeId: igor.id });
    const swap = createSwapRequest(db, {
      fromEmployeeId: anya.id, fromShiftId: anyaShift.id, toEmployeeId: igor.id, toShiftId: igorShift.id,
    });

    const res = await app.request(
      `/api/admin/employees/${anya.id}`,
      authedJson(admin, { isObserver: true, excludedFromSwaps: true }, "PATCH"),
    );
    expect(res.status).toBe(200);

    expect(getSwapRequest(db, swap.id)?.status).toBe("cancelled");
    // Одно письмо на человека — не два (по одному на каждую причину).
    expect(sent.filter((s) => s.chat_id === 201)).toHaveLength(1);
    expect(sent.filter((s) => s.chat_id === 202)).toHaveLength(1);
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
    // Сплошная нумерация — свойство колонки, а не ответа: `rosterOrder` в контракт
    // не входит (ни один экран его отсюда не читает, оба фронта возвращённый
    // список вовсе отбрасывают), поэтому проверяется там, где живёт.
    expect(listForAdmin(db).map((e) => e.rosterOrder)).toEqual([0, 1, 2, 3]);

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

  it("работник выключил напоминания — это видно в журнале", async () => {
    const db = makeTestDb();
    const mark = worker(db, "Марк Волков", 201);
    const app = createApp({ db, config });

    await app.request("/api/me/settings", authedJson(await tokenFor(app, 201), { remindersEnabled: false }, "PATCH"));

    const event = listRecentAudit(db, 10).find((row) => row.type === "settings_changed");
    expect(event?.actorEmployeeId).toBe(mark.id);
    expect((event?.payload as { remindersEnabled: boolean }).remindersEnabled).toBe(false);
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

describe("контракт домена employees", () => {
  it("/api/employees отдаёт коллегу только по имени", async () => {
    const db = makeTestDb();
    worker(db, "Игорь", 333);
    worker(db, "Марк", 444);
    const app = createApp({ db, config });
    const res = await app.request("/api/employees", bearer(await tokenFor(app, 333)));
    const parsed = employeesResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("PATCH /api/admin/employees/:id отдаёт работника той же формы", async () => {
    // Отдельный случай, потому что до контракта эта ручка спредила ряд вторым
    // местом — и один список полей поправили бы, а второй забыли.
    const db = makeTestDb();
    worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const res = await app.request(
      `/api/admin/employees/${target.id}`,
      authedJson(token, { displayName: "Игорь Н." }, "PATCH"),
    );
    const body = (await res.json()) as { employee: unknown };
    const parsed = adminEmployeeSchema.safeParse(body.employee);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("/api/admin/employees отдаёт ровно обещанное, без токена приглашения", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 111);
    worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/employees", bearer(await tokenFor(app, 111)));
    const parsed = adminEmployeesResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  // Три ручки ниже отдавали ряд не спредом, а самим объектом (`c.json({ employee })`),
  // поэтому grep по `...employee`, которым ловили первые две, их не видел. Форма у
  // них была та же самая: десять нужных полей плюс девять колонок ряда, включая
  // `inviteToken`.
  it("POST /api/admin/employees отдаёт созданного работника той же формы", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 111);
    const app = createApp({ db, config });
    const res = await app.request(
      "/api/admin/employees",
      authedJson(await tokenFor(app, 111), { displayName: "Марк" }),
    );
    const body = (await res.json()) as { employee: unknown };
    const parsed = adminEmployeeSchema.safeParse(body.employee);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("POST /api/admin/employees/:id/role отдаёт работника той же формы", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(
      `/api/admin/employees/${target.id}/role`,
      authedJson(await tokenFor(app, 111), { isAdmin: true }),
    );
    const body = (await res.json()) as { employee: unknown };
    const parsed = adminEmployeeSchema.safeParse(body.employee);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("POST /api/admin/employees/:id/order отдаёт список той же формы", async () => {
    const db = makeTestDb();
    worker(db, "Аня", 111);
    const target = worker(db, "Игорь", 333);
    const app = createApp({ db, config });
    const res = await app.request(
      `/api/admin/employees/${target.id}/order`,
      authedJson(await tokenFor(app, 111), { position: 1 }),
    );
    const parsed = adminEmployeesResponseSchema.safeParse(await res.json());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});
