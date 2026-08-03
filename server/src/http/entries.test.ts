import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { getShift, createShift } from "../repo/shifts";
import { buildRosterCsv } from "../roster/roster-service";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("schedule edits are auditable", () => {
  const FRIDAY = "2026-07-10";

  it("records who created, changed and deleted an entry, and what changed", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const adminId = (await (await app.request("/api/me", { headers: { Authorization: `Bearer ${admin}` } })).json()).id as number;

    const created = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: FRIDAY, category: "shift", start: "09:00", end: "18:00", title: "День", employeeId: anya.id }),
    );
    const id = (await created.json()).entry.id as number;

    await app.request(`/api/admin/entries/${id}`, authedJson(admin, { start: "11:00", end: "20:00", title: "Вечер" }, "PATCH"));
    await app.request(`/api/admin/entries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });

    const events = listRecentAudit(db, 10);
    expect(events.map((e) => e.type)).toEqual(["entry_deleted", "entry_updated", "entry_created"]);
    expect(events.every((e) => e.actorEmployeeId === adminId)).toBe(true);

    const updated = events.find((e) => e.type === "entry_updated")!.payload as {
      before: { title: string; start: string }; after: { title: string; start: string };
    };
    expect(updated.before).toMatchObject({ title: "День", start: "09:00" });
    expect(updated.after).toMatchObject({ title: "Вечер", start: "11:00" });

    const deleted = events.find((e) => e.type === "entry_deleted")!.payload as { entryId: number; title: string };
    expect(deleted).toMatchObject({ entryId: id, title: "Вечер" });
  });

  it("refuses to edit a range into ending before it starts", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: "2026-07-20", endDate: "2026-07-24", category: "vacation", employeeId: anya.id }),
    );
    const id = (await created.json()).entry.id as number;

    // Moving only the start past the existing end. The patch itself carries one
    // date, so nothing but the merge can see that the pair is now backwards — and
    // a backwards range is an entry no reader of a period ever finds again.
    const res = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { date: "2026-07-28" }, "PATCH"));
    expect(res.status).toBe(400);
    expect(getShift(db, id)).toMatchObject({ date: "2026-07-20", endDate: "2026-07-24" });
  });

  it("logs nothing when the edit was rejected", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    // Missing 'end' — createEntrySchema rejects it, so no row and no audit line.
    const res = await app.request("/api/admin/entries", authedJson(admin, { date: FRIDAY, category: "shift", start: "09:00" }));
    expect(res.status).toBe(400);
    expect(listRecentAudit(db, 10)).toHaveLength(0);

    const missing = await app.request("/api/admin/entries/999", { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
    expect(missing.status).toBe(404);
    expect(listRecentAudit(db, 10)).toHaveLength(0);
  });
});

describe("admin ranged reports validate their span", () => {
  it("rejects malformed and reversed date ranges", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const auth = { headers: { Authorization: `Bearer ${admin}` } };

    expect((await app.request("/api/admin/weekend/payroll?from=nope&to=2026-07-31", auth)).status).toBe(400);
    expect((await app.request("/api/admin/weekend/payroll?from=2026-07-31&to=2026-07-01", auth)).status).toBe(400);
    expect((await app.request("/api/admin/weekend/payroll.csv?from=2026-02-30&to=2026-07-31", auth)).status).toBe(400);
    expect((await app.request("/api/admin/weekend/payroll?from=2020-01-01&to=2026-12-31", auth)).status).toBe(400);
    expect((await app.request("/api/admin/weekend/payroll?from=2026-07-01&to=2026-07-31", auth)).status).toBe(200);
  });

  it("rejects a distribute call with a bad or unbounded range", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    expect((await app.request("/api/admin/distribute", authedJson(admin, { from: "07/01/2026", to: "2026-07-31" }))).status).toBe(400);
    expect((await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-31", to: "2026-07-01" }))).status).toBe(400);
    expect((await app.request("/api/admin/distribute", authedJson(admin, { from: "2020-01-01", to: "2026-12-31" }))).status).toBe(400);
    expect((await app.request("/api/admin/distribute", authedJson(admin, { from: "2026-07-01", to: "2026-07-31" }))).status).toBe(200);
  });
});

describe("admin entry endpoints", () => {
  /** 2026-07-11 is a Saturday, 2026-07-10 a Friday — fixed dates keep these deterministic. */
  const SATURDAY = "2026-07-11";
  const FRIDAY = "2026-07-10";

  it("switching an entry to an absence clears its times instead of 400-ing", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: FRIDAY, category: "shift", start: "09:00", end: "18:00", employeeId: anya.id }),
    );
    const id = (await created.json()).entry.id as number;

    // The form only sends what changed — it has no times to send for an absence, so
    // the row's leftover 09:00–18:00 used to trip "absences must not have times".
    for (const category of ["business_trip", "vacation", "sick_leave"] as const) {
      const res = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { category, employeeId: anya.id }, "PATCH"));
      expect(res.status).toBe(200);
      const row = getShift(db, id)!;
      expect(row.category).toBe(category);
      expect(row.start).toBeNull();
      expect(row.end).toBeNull();
    }

    // And back: a timed category drops the absence's multi-day range.
    const back = await app.request(
      `/api/admin/entries/${id}`,
      authedJson(admin, { category: "shift", start: "09:00", end: "18:00", employeeId: anya.id }, "PATCH"),
    );
    expect(back.status).toBe(200);
    expect(getShift(db, id)!.endDate).toBeNull();
  });

  it("refuses «работа в выходной» on a weekday, allows it on a weekend", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const body = (date: string) => ({ date, category: "weekend_work", start: "10:00", end: "18:00", employeeId: anya.id });

    expect((await app.request("/api/admin/entries", authedJson(admin, body(FRIDAY)))).status).toBe(400);
    expect((await app.request("/api/admin/entries", authedJson(admin, body(SATURDAY)))).status).toBe(201);

    // The same guard holds on edit, not just create.
    const id = (await (await app.request("/api/admin/entries", authedJson(admin, body(SATURDAY)))).json()).entry.id as number;
    const moved = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { date: FRIDAY }, "PATCH"));
    expect(moved.status).toBe(400);
  });

  it("creates, updates, and deletes an entry (admin only)", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request("/api/admin/entries", authedJson(admin, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: anya.id }));
    expect(created.status).toBe(201);
    const id = (await created.json()).entry.id as number;
    expect(getShift(db, id)?.employeeId).toBe(anya.id);

    const patched = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { category: "duty", location: "Вавилова" }, "PATCH"));
    expect(patched.status).toBe(200);
    expect((await patched.json()).entry.category).toBe("duty");

    const del = await app.request(`/api/admin/entries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${admin}` } });
    expect(del.status).toBe(200);
    expect(getShift(db, id)).toBeUndefined();
  });

  it("rejects a worker (403) and validates the body (400)", async () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 333);
    const app = createApp({ db, config });

    const worker = await tokenFor(app, 333);
    const forbidden = await app.request("/api/admin/entries", authedJson(worker, { date: "2026-07-10" }));
    expect(forbidden.status).toBe(403);

    const admin = await tokenFor(app, 111);
    const bad = await app.request("/api/admin/entries", authedJson(admin, { date: "nope" }));
    expect(bad.status).toBe(400);

    const missing = await app.request("/api/admin/entries/999", authedJson(admin, { note: "x" }, "PATCH"));
    expect(missing.status).toBe(404);
  });

  it("rejects a PATCH that would strand the entry in an incoherent category/times state", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request("/api/admin/entries", authedJson(admin, { date: "2026-07-10", category: "vacation" }));
    expect(created.status).toBe(201);
    const id = (await created.json()).entry.id as number;

    const patched = await app.request(`/api/admin/entries/${id}`, authedJson(admin, { category: "shift" }, "PATCH"));
    expect(patched.status).toBe(400);
  });

  it("maps an unknown foreign-key reference to 400, not 500", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const created = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: 99999 }),
    );
    expect(created.status).toBe(400);
  });
});

// Same rule the weekend market already learned: the middleware guards the ACTOR,
// and nothing looked at the target. An entry written onto an archived person is
// invisible everywhere — `/api/team/schedule` filters those rows out and both grids
// draw their people from that same response — so the admin gets a cheerful 201 for
// a write that shows up nowhere.
describe("записи на архивного сотрудника", () => {
  it("не создаются (400), и в базе ничего не остаётся", async () => {
    const db = makeTestDb();
    const gone = createEmployee(db, { displayName: "Уволенный Олег" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    await app.request(`/api/admin/employees/${gone.id}/archive`, authedJson(admin, {}));

    const res = await app.request("/api/admin/entries", authedJson(admin, {
      date: "2026-09-01", category: "shift", start: "09:00", end: "18:00", employeeId: gone.id, title: "День",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/архив/i);

    const list = await app.request(`/api/team/schedule?from=2026-09-01&to=2026-09-01`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect((await list.json()).shifts).toHaveLength(0);
  });

  it("и не переносятся на архивного правкой (400)", async () => {
    const db = makeTestDb();
    const active = createEmployee(db, { displayName: "Активный Антон" });
    const gone = createEmployee(db, { displayName: "Уволенный Олег" });
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    await app.request(`/api/admin/employees/${gone.id}/archive`, authedJson(admin, {}));

    const created = await app.request("/api/admin/entries", authedJson(admin, {
      date: "2026-09-01", category: "shift", start: "09:00", end: "18:00", employeeId: active.id, title: "День",
    }));
    const entryId = (await created.json()).entry.id as number;

    const moved = await app.request(`/api/admin/entries/${entryId}`, authedJson(admin, { employeeId: gone.id }, "PATCH"));
    expect(moved.status).toBe(400);
    expect(getShift(db, entryId)!.employeeId).toBe(active.id);
  });

  it("вакантную запись без сотрудника это не трогает", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const res = await app.request("/api/admin/entries", authedJson(admin, {
      date: "2026-09-01", category: "shift", start: "09:00", end: "18:00", employeeId: null, title: "День",
    }));
    expect(res.status).toBe(201);
  });
});

// Он правит нераспознанную клетку в обычную смену — и клетка остаётся прежней.
// `unrecognisedCode` не описан в `updateEntrySchema`, поэтому снять его было нечем,
// а читатели ставят его выше всего: `encodeEntryCode` возвращает сырой текст первым,
// отчёт кладёт запись в ведро «не распознано», обе сетки рисуют её тем же.
describe("нераспознанная клетка чинится правкой", () => {
  const unread = { date: "2026-08-12", category: "shift" as const, employeeId: null, unrecognisedCode: "Ко" };

  it("правка, называющая смену, снимает пометку «не распознано»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, unread);

    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      templateId: 2, title: "День", start: "09:00", end: "18:00",
    }, "PATCH"));

    expect(res.status).toBe(200);
    expect(getShift(db, entry.id)!.unrecognisedCode).toBeNull();
  });

  it("после этого выгрузка пишет нормальный код, а не сырой текст из файла", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Правленый Пётр" });
    const entry = createShift(db, { ...unread, employeeId: w.id });
    expect(buildRosterCsv(db, "2026-08-12", "2026-08-12")).toContain("Ко");

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      templateId: 2, title: "День", start: "09:00", end: "18:00",
    }, "PATCH"));

    const csv = buildRosterCsv(db, "2026-08-12", "2026-08-12");
    expect(csv).toContain("k32");
    expect(csv).not.toContain("Ко");
  });

  it("а перенос клетки на другой день её не «дочитывает»", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, unread);

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: "2026-08-13" }, "PATCH"));
    expect(getShift(db, entry.id)!.unrecognisedCode).toBe("Ко");
  });
});

// Он поменял смену на «Отпуск» из админки в телеграме — и на экране не изменилось
// ничего. Правка доходила: в базе `category` = `vacation`, часы сняты. А вот `title`
// («Утро») и `template_id` (пресет «Утро») оставались от прежней категории, и обе
// сетки рисуют клетку по ним: подпись это `title ?? categoryLabel(category)`, цвет —
// по пресету. То есть клетка оставалась ровно той же смены и того же цвета.
// Хуже того, `encodeEntryCode` ставит пресет ВЫШЕ категории отсутствия: выгрузка
// писала в CSV код смены, и круг «скачал → поправил → залил» стирал отпуск обратно
// в смену. Обе морды шлют при смене категории только её (`isMultiDay`-ветка в
// `buildInput`), поэтому чинится на сервере — там, где решение, а не у одной двери.
describe("смена категории не тащит за собой прежний вид смены", () => {
  const morning = { date: "2026-08-04", category: "shift" as const, start: "08:00", end: "17:00", title: "Утро", templateId: 1 };

  it("«Утро» → «Отпуск»: подпись и пресет уходят вместе с часами", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Отпускной Олег" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    // Ровно то, что шлёт форма записи в обеих мордах при выборе «Отпуск».
    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: morning.date, category: "vacation" }, "PATCH"));
    expect(res.status).toBe(200);

    const after = getShift(db, entry.id)!;
    expect(after.category).toBe("vacation");
    expect(after.start).toBeNull();
    // Подпись «Утро» — это то, что человек читает в клетке вместо «Отпуск».
    expect(after.title).toBeNull();
    // Пресет — это цвет клетки и код в выгрузке.
    expect(after.templateId).toBeNull();
  });

  it("выгрузка после такой правки пишет отпуск, а не смену", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Отпускной Олег" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: morning.date, category: "vacation" }, "PATCH"));

    const csv = buildRosterCsv(db, morning.date, morning.date);
    expect(csv).toContain("otp");
    // Пресет «Утро» в этой строке означал бы, что круг «скачал → залил» вернул смену.
    expect(csv).not.toContain("k32-8");
  });

  it("но подпись, присланную вместе со сменой категории, не трогает", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Дежурный Дмитрий" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      date: morning.date, category: "duty", start: "09:00", end: "18:00", title: "Вавилова",
    }, "PATCH"));

    const after = getShift(db, entry.id)!;
    expect(after.category).toBe("duty");
    expect(after.title).toBe("Вавилова");
  });

  it("правка внутри той же категории подпись не теряет", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Обычный Олег" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: "2026-08-05" }, "PATCH"));

    const after = getShift(db, entry.id)!;
    expect(after.title).toBe("Утро");
    expect(after.templateId).toBe(1);
  });
});

// Уже испорченные записи (он сделал две таких живьём до починки) обязаны лечиться
// простым пересохранением: если снимать подпись только при СМЕНЕ категории,
// «отпуск → отпуск» ничего не поправит, и клетка так и останется «Утро».
describe("запись, уже испорченная прежним поведением, чинится пересохранением", () => {
  it("«отпуск», сохранённый отпуском, теряет чужую подпись и пресет", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Отпускной Олег" });
    // Ровно то, что лежит в живой базе: отпуск с подписью и пресетом «Утро».
    const entry = createShift(db, {
      date: "2026-08-04", category: "vacation", start: null, end: null,
      title: "Утро", templateId: 1, employeeId: w.id,
    });

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: "2026-08-04", category: "vacation" }, "PATCH"));

    const after = getShift(db, entry.id)!;
    expect(after.title).toBeNull();
    expect(after.templateId).toBeNull();
  });
});

// Та же семья, что находка про категорию, только другая ветка формы: «своё время».
// Обе морды в этой ветке пишут `title: null` (комментарий рядом прямо говорит —
// «снять устаревшее имя пресета»), но `templateId` не снимают. Пресет — это цвет
// клетки и код в выгрузке: смена, которой руками поставили 10:00–19:00, оставалась
// цвета «Утро» и выгружалась кодом «Утро», то есть круг через Excel возвращал ей
// 08:00–17:00. Правка, назвавшая часы и не назвавшая пресет, пресетом больше не
// описывается.
describe("своё время снимает пресет", () => {
  const morning = { date: "2026-08-04", category: "shift" as const, start: "08:00", end: "17:00", title: "Утро", templateId: 1 };

  it("часы, поставленные руками, отвязывают запись от пресета", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Свойвремя Семён" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    // Ровно то, что шлёт форма в режиме «Своё время».
    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      date: morning.date, category: "shift", start: "10:00", end: "19:00", title: null,
    }, "PATCH"));

    const after = getShift(db, entry.id)!;
    expect(after.start).toBe("10:00");
    expect(after.templateId).toBeNull();
    // Выгрузка обязана сказать «такое клеткой не опишешь», а не «Утро».
    expect(buildRosterCsv(db, morning.date, morning.date)).toContain("?");
  });

  it("а выбранный пресет правку переживает", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Пресетный Пётр" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    // Ровно то, что шлёт форма в режиме пресета.
    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      date: morning.date, category: "shift", templateId: 2, start: "09:00", end: "18:00", title: "День",
    }, "PATCH"));

    expect(getShift(db, entry.id)!.templateId).toBe(2);
  });

  it("перенос записи на другой день пресет не трогает", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);
    const w = createEmployee(db, { displayName: "Переносный Пётр" });
    const entry = createShift(db, { ...morning, employeeId: w.id });

    await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: "2026-08-05" }, "PATCH"));

    expect(getShift(db, entry.id)!.templateId).toBe(1);
  });
});
