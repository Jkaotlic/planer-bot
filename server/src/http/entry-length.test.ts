import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { MAX_RANGE_DAYS, createEntrySchema } from "./entry-schema";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import { teamNow } from "../util/team-time";
import { addDaysIso } from "@planer/shared";
import { testConfig } from "../test-config";

/**
 * Запись-отсутствие не длиннее `MAX_RANGE_DAYS` дней.
 *
 * `endDate` без верхней границы — больничный «до 9999 года»: `daysOf`/`eachDayIso`
 * разворачивают такую запись в ~36 млн дней прямо в процессе, который держит и
 * API, и бота. Опечатка в году делает то же самое без злого умысла.
 */

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Аня" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  ((await (await app.request("/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  })).json()) as { token: string }).token;
const authedJson = (t: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

const START = "2026-11-02";
/** Последний допустимый день: запись `START..LAST_OK` длиной ровно `MAX_RANGE_DAYS`. */
const LAST_OK = addDaysIso(START, MAX_RANGE_DAYS - 1);
const ONE_TOO_MANY = addDaysIso(START, MAX_RANGE_DAYS);

function stage() {
  const db = makeTestDb();
  const anya = createEmployee(db, { displayName: "Аня" });
  return { db, anya, app: createApp({ db, config }) };
}

describe("длина записи-отсутствия", () => {
  it("схема создания: ровно предел — можно, на день больше — нет, 9999 год — нет", () => {
    const ok = createEntrySchema.safeParse({ date: START, endDate: LAST_OK, category: "sick_leave" });
    expect(ok.success).toBe(true);
    expect(createEntrySchema.safeParse({ date: START, endDate: ONE_TOO_MANY, category: "sick_leave" }).success).toBe(false);
    expect(createEntrySchema.safeParse({ date: START, endDate: "9999-12-31", category: "vacation" }).success).toBe(false);
  });

  it("POST /api/admin/entries: больничный до 9999 года — 400, записи нет", async () => {
    const { app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const res = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: START, endDate: "9999-12-31", category: "sick_leave", employeeId: anya.id }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(`не может быть длиннее ${MAX_RANGE_DAYS} дней`);
  });

  it("POST /api/admin/entries/bulk: одна длинная запись отклоняет пачку", async () => {
    const { app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const res = await app.request(
      "/api/admin/entries/bulk",
      authedJson(admin, { entries: [{ date: START, endDate: ONE_TOO_MANY, category: "vacation", employeeId: anya.id }] }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH сверяет итог после слияния: сдвиг только `date` назад делает запись длиннее предела — 400", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: LAST_OK, category: "vacation", start: null, end: null });

    // В теле нет `endDate` — длинной запись делает существующий конец.
    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: addDaysIso(START, -1) }, "PATCH"));
    expect(res.status).toBe(400);
    expect(getShift(db, entry.id)!.date).toBe(START);
  });

  it("PATCH: продление до 9999 года — 400; в пределах — 200", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: START, category: "sick_leave", start: null, end: null });

    const far = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { endDate: "9999-12-31" }, "PATCH"));
    expect(far.status).toBe(400);
    const near = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { endDate: LAST_OK }, "PATCH"));
    expect(near.status).toBe(200);
    expect(getShift(db, entry.id)!.endDate).toBe(LAST_OK);
  });

  it("PATCH без дат: запись, длинная ещё до предела (декрет одной строкой), правится — заметка сохраняется", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: addDaysIso(START, 500), category: "vacation", start: null, end: null });

    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { note: "декрет" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(getShift(db, entry.id)!.note).toBe("декрет");
  });

  it("PATCH телом формы (даты те же, что в записи): длинная старая запись правится — 200", async () => {
    // Обе формы шлют date и endDate всегда, даже если меняли только заметку.
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const END = addDaysIso(START, 500);
    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: END, category: "vacation", start: null, end: null });

    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, {
      category: "vacation", date: START, endDate: END, employeeId: anya.id, start: null, end: null, note: "декрет",
    }, "PATCH"));
    expect(res.status).toBe(200);
    expect(getShift(db, entry.id)!.note).toBe("декрет");
  });

  it("отказ по длине называет предел в error — морды показывают его как есть (POST и PATCH)", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const text = `запись не может быть длиннее ${MAX_RANGE_DAYS} дней — разбейте её на части`;

    const posted = await app.request(
      "/api/admin/entries",
      authedJson(admin, { date: START, endDate: ONE_TOO_MANY, category: "sick_leave", employeeId: anya.id }),
    );
    expect(posted.status).toBe(400);
    expect((await posted.json()).error).toBe(text);

    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: START, category: "sick_leave", start: null, end: null });
    const patched = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { endDate: ONE_TOO_MANY }, "PATCH"));
    expect(patched.status).toBe(400);
    expect((await patched.json()).error).toBe(text);
  });

  it("POST /api/my/entries: работник не ставит себе больничный до 9999 года", async () => {
    const { db, app } = stage();
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-igor" });
    linkTelegramAccount(db, "inv-igor", 777);
    const token = await tokenFor(app, 777);
    const today = teamNow(config.teamTz).date;
    const res = await app.request("/api/my/entries", authedJson(token, { category: "sick_leave", date: today, endDate: "9999-12-31" }));
    expect(res.status).toBe(400);
  });

  it("конец раньше начала: PATCH называет причину в error, а не «invalid»", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, { employeeId: anya.id, date: START, endDate: LAST_OK, category: "vacation", start: null, end: null });

    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { endDate: addDaysIso(START, -1) }, "PATCH"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("запись не может кончаться раньше, чем начинается");
  });
});

describe("отказ «работа в выходной на будний день» — словами в error", () => {
  // START — понедельник, 2.11.2026: обычный рабочий день.
  const WEEKDAY = START;
  const body = { date: WEEKDAY, category: "weekend_work", start: "10:00", end: "18:00" };
  const TEXT = "«Работа в выходной» может стоять только на выходной или праздник";

  it("POST /api/admin/entries", async () => {
    const { app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const res = await app.request("/api/admin/entries", authedJson(admin, { ...body, employeeId: anya.id }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(TEXT);
  });

  it("POST /api/admin/entries/bulk", async () => {
    const { app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const res = await app.request("/api/admin/entries/bulk", authedJson(admin, { entries: [{ ...body, employeeId: anya.id }] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(TEXT);
  });

  it("PATCH /api/admin/entries/:id", async () => {
    const { db, app, anya } = stage();
    const admin = await tokenFor(app, 111);
    const entry = createShift(db, { employeeId: anya.id, date: "2026-11-07", category: "weekend_work", start: "10:00", end: "18:00" });
    const res = await app.request(`/api/admin/entries/${entry.id}`, authedJson(admin, { date: WEEKDAY }, "PATCH"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(TEXT);
  });
});
