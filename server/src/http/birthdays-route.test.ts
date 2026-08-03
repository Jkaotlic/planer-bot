import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { signInitData } from "../auth/telegram";
import type { Config } from "../config";
import type { Db } from "../db/client";

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
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const send = (token: string, body: unknown, method: string) => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const ASOF = "asOf=2026-08-01";

/** A bot that records what it was asked to send instead of talking to Telegram. */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

function person(db: Db, name: string, tg: number | null, birthDate: string | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  return employee.id;
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
  it("saves the link and the wording", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    const res = await app.request(`/api/admin/birthdays/${id}?${ASOF}`,
      send(token, { collectUrl: "https://sber.ru/x", messageText: "Скидываемся!" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).campaign).toMatchObject({ collectUrl: "https://sber.ru/x", status: "ready" });
  });

  it("refuses a link that isn't http(s) — it travels to the whole team", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");
    for (const bad of ["javascript:alert(1)", "sber.ru/x", "просто текст"]) {
      const res = await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: bad }, "PUT"));
      expect(res.status, `«${bad}» must be rejected`).toBe(400);
    }
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

describe("POST /api/admin/birthdays/:id/send", () => {
  const ready = async (db: Db, app: ReturnType<typeof createApp>, token: string) => {
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Первый", 2, null);
    person(db, "Второй", 3, null);
    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: "https://sber.ru/x" }, "PUT"));
    return id;
  };

  it("refuses to send without an explicit confirmation", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);

    expect((await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, {}, "POST"))).status).toBe(400);
    expect((await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: false }, "POST"))).status).toBe(400);
    expect(sent, "nothing may be sent without confirmation").toEqual([]);
  });

  it("sends to everyone but the birthday person, once confirmed", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);

    const res = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(res.status).toBe(200);
    // Three, not two: the allowlisted admin auto-registers on first auth and is a
    // colleague like any other — they get the collection too.
    expect(await res.json()).toEqual({ delivered: 3, intended: 3 });
    expect(sent.map((m) => m.to).sort((a, b) => a - b)).toEqual([2, 3, 111]);
    expect(sent[0]!.text).toContain("https://sber.ru/x");
    expect(sent.some((m) => m.to === 1), "the birthday person must not be told").toBe(false);
  });

  it("refuses a second send, so nobody is messaged twice", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);

    await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    const again = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(again.status).toBe(409);
    expect(sent).toHaveLength(3);
  });

  it("refuses to send with no link, however confirmed", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");
    person(db, "Коллега", 2, null);

    const res = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(res.status).toBe(409);
    expect(sent).toEqual([]);
  });

  it("does not call it sent when nobody got it — the admin can try again", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    // Телеграм отвечает 429 всей рассылке: ни одно сообщение не ушло.
    (bot.api.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429: Too Many Requests"));
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);

    const first = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(await first.json()).toEqual({ delivered: 0, intended: 3 });
    expect(sent, "ни одно сообщение не ушло").toEqual([]);

    // Кампания не «разослана»: рассылки не было, а «повторная отправка отключена»
    // навсегда закрыла бы единственную кнопку. Никого не задваиваем — до людей
    // ничего не дошло.
    const listed = await (await app.request(`/api/admin/birthdays?${ASOF}`, auth(token))).json();
    const mine = listed.birthdays.find((b: { employeeId: number }) => b.employeeId === id);
    expect(mine.campaign.status, "нулевая доставка — не «sent»").not.toBe("sent");

    (bot.api.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (to: number, text: string) => {
      sent.push({ to, text });
    });
    const retry = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(retry.status, "вторая попытка должна пройти").toBe(200);
    expect(await retry.json()).toEqual({ delivered: 3, intended: 3 });
  });

  it("still refuses a repeat when somebody did get it", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);
    // Двое из троих в отказе — но один человек поздравление уже прочитал.
    (bot.api.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (to: number, text: string) => {
      if (to !== 2) throw new Error("403: bot was blocked by the user");
      sent.push({ to, text });
    });

    const res = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(await res.json()).toEqual({ delivered: 1, intended: 3 });
    const again = await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(again.status, "повтор задвоил бы поздравление тому, кто его получил").toBe(409);
    expect(sent).toHaveLength(1);
  });

  it("records who sent it and to how many", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);
    await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));

    const logged = listRecentAudit(db, 5).find((row) => row.type === "birthday_sent")!;
    expect(logged.payload).toMatchObject({ employeeId: id, delivered: 3, intended: 3 });
    expect(logged.actorEmployeeId).not.toBeNull();
  });

  it("does not pretend to send when the bot isn't running", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config }); // no bot
    const token = await tokenFor(app, 111);
    const id = await ready(db, app, token);
    expect((await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"))).status).toBe(503);
  });

  it("leaves an admin whose own birthday it is out of the team message", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const id = person(db, "Админ-именинник", 1, "08-05");
    setEmployeeAdmin(db, id, true);
    person(db, "Коллега", 2, null);
    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: "https://sber.ru/x" }, "PUT"));

    await app.request(`/api/admin/birthdays/${id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect(sent.map((m) => m.to)).not.toContain(1);
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
    expect((await res.json()).campaign).toMatchObject({ scheduledSendOn: "2026-08-03", scheduleNotifiedAt: null });
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
    expect((await res.json()).campaign).toMatchObject({ collectUrl: "https://sber.ru/x", scheduledSendOn: "2026-08-01" });
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
    expect((await cleared.json()).campaign.scheduledSendOn).toBeNull();
  });
});

describe("GET /api/admin/birthdays/campaigns", () => {
  it("returns a round whose birthday has already passed — which /birthdays cannot", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const id = person(db, "Именинник", 1, "08-05");

    // Prepare the 2026 round while it is still ahead of us…
    await app.request(`/api/admin/birthdays/${id}?${ASOF}`, send(token, { collectUrl: "https://sber.ru/x" }, "PUT"));

    // …then look from a month later, when `upcomingBirthdays` keys on 2027 and
    // drops the 2026 round entirely. This is the gap the endpoint exists to fill.
    const upcoming = await (await app.request("/api/admin/birthdays?asOf=2026-09-01", auth(token))).json();
    expect(upcoming.birthdays.find((b: { employeeId: number }) => b.employeeId === id).campaign).toBeNull();

    const { campaigns } = await (await app.request("/api/admin/birthdays/campaigns", auth(token))).json();
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ displayName: "Именинник", birthDateLabel: "5 августа" });
    expect(campaigns[0].campaign).toMatchObject({ collectUrl: "https://sber.ru/x", year: 2026 });
  });

  it("is admin-only", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    person(db, "Работник", 222, null);
    expect((await app.request("/api/admin/birthdays/campaigns", auth(await tokenFor(app, 222)))).status).toBe(403);
  });
});
