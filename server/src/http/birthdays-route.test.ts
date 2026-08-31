import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import { collections } from "../db/schema";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const send = (token: string, body: unknown, method: string) => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const ASOF = "asOf=2026-08-01";

function person(db: Db, name: string, tg: number | null, birthDate: string | null, isAdmin = false): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  if (isAdmin) setEmployeeAdmin(db, employee.id, true);
  return employee.id;
}

/** Бот, который записывает письма вместо того, чтобы ходить в Telegram. */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

describe("GET /api/admin/birthdays", () => {
  it("lists who is next, with nothing prepared yet", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    person(db, "Скоро", 1, "08-05");
    person(db, "Позже", 2, "11-20");
    const res = await app.request(`/api/admin/birthdays?${ASOF}`, auth(await tokenFor(app, 111)));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.birthdays.map((b: { displayName: string }) => b.displayName)).toEqual(["Скоро", "Позже"]);
    expect(body.birthdays[0]).toMatchObject({ daysUntil: 4, birthDateLabel: "5 августа", campaign: null });
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    person(db, "Работник", 222, null);
    expect((await app.request(`/api/admin/birthdays?${ASOF}`, auth(await tokenFor(app, 222)))).status).toBe(403);
  });
});

describe("PUT /api/admin/birthdays/:id", () => {
  it("creates the round on the first save and reuses it on the second", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    const token = await tokenFor(app, 111);

    const first = await (await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"))).json();
    const second = await (await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/2" }, "PUT"))).json();

    expect(second.collection.id).toBe(first.collection.id);
    expect(db.select().from(collections).all().length).toBe(1);
  });

  it("правка сбора попадает в журнал фактом, а не текстом поздравления", async () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь Петров", 201, "08-05");
    const app = createApp({ db, config });
    const admin = await tokenFor(app, 111);

    const res = await app.request(`/api/admin/birthdays/${igor}?${ASOF}`, send(admin, { messageText: "Скидываемся Игорю" }, "PUT"));
    expect(res.status).toBe(200);

    const event = listRecentAudit(db, 10).find((row) => row.type === "birthday_campaign_updated");
    expect((event?.payload as { displayName: string }).displayName).toBe("Игорь Петров");
    // Текст поздравления в журнал не копируется — только факт правки.
    expect(JSON.stringify(event?.payload)).not.toContain("Скидываемся");
  });

  it("still refuses a link that is not http(s)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    const token = await tokenFor(app, 111);
    const res = await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "javascript:alert(1)" }, "PUT"));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/birthdays/:id — ссылка вооружает автоотправку", () => {
  const SEP = "asOf=2026-09-01";

  it("сохранение ссылки из консоли вооружает автоотправку", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const mark = person(db, "Марк", 1, "09-07");
    const res = await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(await tokenFor(app, 111), { collectUrl: "https://example.com/sbor" }, "PUT"));

    expect(res.status).toBe(200);
    const { collection } = await res.json();
    expect(collection.autoSendOn).toBe("2026-09-04");
  });

  it("выключенную автоотправку новая ссылка вооружает заново", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const mark = person(db, "Марк", 1, "09-07");
    const token = await tokenFor(app, 111);
    // Раунд заводится вооружённым, поэтому «ссылка вооружает» видно только на
    // выключенном: иначе тест прошёл бы и без единой строки вооружения в ручке.
    await app.request(`/api/admin/birthdays/${mark}?${SEP}`, send(token, { autoSendOn: null }, "PUT"));

    const res = await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(token, { collectUrl: "https://example.com/sbor" }, "PUT"));

    expect((await res.json()).collection.autoSendOn).toBe("2026-09-04");
  });

  it("явно заданный день не перебивается вычисленным", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const mark = person(db, "Марк", 1, "09-07");
    const res = await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(await tokenFor(app, 111), { collectUrl: "https://example.com/sbor", autoSendOn: "2026-09-06" }, "PUT"));

    expect((await res.json()).collection.autoSendOn).toBe("2026-09-06");
  });

  it("переключатель выключает автоотправку", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const mark = person(db, "Марк", 1, "09-07");
    const res = await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(await tokenFor(app, 111), { autoSendOn: null }, "PUT"));

    expect(res.status).toBe(200);
    expect((await res.json()).collection.autoSendOn).toBeNull();
  });

  it("остальные админы узнают о ссылке, вставленной из консоли", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Игорь", 2, null, true);
    // Одинаковое поведение у двух входов и есть смысл этой правки: письмо про
    // вставленную ссылку обязано уйти и когда её сохранили из вебки.
    await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(await tokenFor(app, 111), { collectUrl: "https://example.com/sbor" }, "PUT"));

    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).toContain("Марк");
    expect(sent[0]!.text).toContain("4 сентября");
  });

  it("правка без ссылки никого не будит", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const mark = person(db, "Марк", 1, "09-07");
    person(db, "Игорь", 2, null, true);
    await app.request(`/api/admin/birthdays/${mark}?${SEP}`,
      send(await tokenFor(app, 111), { messageText: "Скидываемся Марку" }, "PUT"));

    expect(sent).toHaveLength(0);
  });
});

describe("GET /api/admin/birthdays/:id/preview", () => {
  it("creates nothing — looking is not preparing", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    person(db, "Colleague", 2, null);
    const token = await tokenFor(app, 111);

    const before = db.select().from(collections).all().length;
    const res = await app.request(`/api/admin/birthdays/${honouree}/preview?${ASOF}`, auth(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(0);
    expect(body.blocker).toContain("Нет ссылки");
    // The point of the whole change: the table is untouched.
    expect(db.select().from(collections).all().length).toBe(before);
  });

  it("shows the saved round once there is one", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const honouree = person(db, "Honouree", 1, "08-05");
    person(db, "Colleague", 2, null);
    const token = await tokenFor(app, 111);

    await app.request(`/api/admin/birthdays/${honouree}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"));
    const body = await (await app.request(`/api/admin/birthdays/${honouree}/preview?${ASOF}`, auth(token))).json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.blocker).toBeNull();
    expect(body.message).toContain("https://example.test/c/1");
  });
});

describe("preview — what the admin sees before anything leaves", () => {
  it("shows the message and every recipient, and never the birthday person", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);
    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: "https://sber.ru/x" }, "PUT"));

    const preview = await (await app.request(`/api/admin/birthdays/${id}/preview?${ASOF}`, auth(token))).json();
    expect(preview.recipients.map((r: { displayName: string }) => r.displayName)).not.toContain("Именинник");
    expect(preview.message).toContain("https://sber.ru/x");
    expect(preview.blocker).toBeNull();
  });
});

describe("the admin whose birthday it is", () => {
  it("does not see their own round in the list", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const self = person(db, "SelfAdmin", 111, "08-12");
    setEmployeeAdmin(db, self, true);
    person(db, "Other", 2, "08-13");

    const body = await (await app.request(`/api/admin/birthdays?${ASOF}`, auth(await tokenFor(app, 111)))).json();
    // Two people have birthdays — an empty list would pass on a broken filter.
    expect(body.birthdays.map((b: { displayName: string }) => b.displayName)).toEqual(["Other"]);
  });

  it("cannot open or save their own round through either route", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const self = person(db, "SelfAdmin", 111, "08-12");
    setEmployeeAdmin(db, self, true);
    const other = person(db, "Other", 2, "08-13");
    const token = await tokenFor(app, 111);

    // Their own round is invisible through both doors…
    expect((await app.request(`/api/admin/birthdays/${self}/preview?${ASOF}`, auth(token))).status).toBe(404);
    expect((await app.request(`/api/admin/birthdays/${self}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"))).status).toBe(404);

    // …while somebody else's works normally through the same two doors, so a
    // route that 404s on everything would not pass this.
    expect((await app.request(`/api/admin/birthdays/${other}/preview?${ASOF}`, auth(token))).status).toBe(200);
    expect((await app.request(`/api/admin/birthdays/${other}?${ASOF}`,
      send(token, { collectUrl: "https://example.test/c/1" }, "PUT"))).status).toBe(200);

    // And the refusal really was a refusal: nothing was written for the admin.
    expect(db.select().from(collections).all().filter((row) => row.employeeId === self)).toEqual([]);
  });
});

describe("scheduled send date", () => {
  it("saves a reminder date alongside the link", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const res = await app.request(`/api/admin/birthdays/${id}?${ASOF}`,
      send(token, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-03" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).collection).toMatchObject({ scheduledSendOn: "2026-08-03", scheduleNotifiedAt: null });
  });

  it("refuses a date in the past, after the birthday, or in the wrong shape", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const past = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-07-31" }, "PUT"));
    expect(past.status).toBe(400);

    // Reminding to send a collection after the day has been and gone is pointless.
    const late = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-06" }, "PUT"));
    expect(late.status).toBe(400);

    const shape = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "3 августа" }, "PUT"));
    expect(shape.status).toBe(400);
  });

  it("lets a stale reminder date through unchanged, alongside an edit to something else", async () => {
    // The miniapp always resends `scheduledSendOn`, changed or not. If the
    // reminder day has since slipped into the past, that must not block
    // pasting the collection link — resubmitting the round's own stored
    // value is not an edit, even though it now reads as "in the past".
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    await app.request(`/api/admin/birthdays/${id}?asOf=2026-08-01`,
      send(token, { scheduledSendOn: "2026-08-01" }, "PUT"));

    const res = await app.request(`/api/admin/birthdays/${id}?asOf=2026-08-03`,
      send(token, { collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-01" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).collection).toMatchObject({ collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-01" });
  });

  it("still refuses a genuinely different past date, not just any past-looking value", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    await app.request(`/api/admin/birthdays/${id}?asOf=2026-08-01`,
      send(token, { scheduledSendOn: "2026-08-01" }, "PUT"));

    const res = await app.request(`/api/admin/birthdays/${id}?asOf=2026-08-03`,
      send(token, { scheduledSendOn: "2026-08-02" }, "PUT"));
    expect(res.status).toBe(400);
  });

  it("accepts the two boundary dates: exactly today, and exactly the birthday", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const atAsOf = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-01" }, "PUT"));
    expect(atAsOf.status).toBe(200);

    const atCelebratedOn = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-05" }, "PUT"));
    expect(atCelebratedOn.status).toBe(200);
  });

  it("clears the date on null", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: "2026-08-03" }, "PUT"));
    const cleared = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { scheduledSendOn: null }, "PUT"));
    expect((await cleared.json()).collection.scheduledSendOn).toBeNull();
  });
});
