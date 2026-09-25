import { describe, expect, it } from "vitest";
import { addDaysIso } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import { teamNow } from "../util/team-time";

/**
 * Личная ICS-подписка: ручки мини-аппа под `requireAuth` создают и гасят
 * токен, публичная `/cal/<token>.ics` отдаёт файл без авторизации — токен и
 * есть предъявленное право.
 */
const config = testConfig();
const today = teamNow(config.teamTz).date;

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

async function tokenFor(app: ReturnType<typeof createApp>, id: number): Promise<string> {
  const res = await app.request(
    new Request("http://x/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initDataFor(id) }),
    }),
  );
  return ((await res.json()) as { token: string }).token;
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const post = (token: string) => ({ method: "POST", headers: { Authorization: `Bearer ${token}` } });
const del = (token: string) => ({ method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

function worker(db: ReturnType<typeof makeTestDb>, tg: number, displayName: string) {
  const employee = createEmployee(db, { displayName, inviteToken: `inv-${tg}` });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  return employee;
}

/** Достаёт из ссылки `.../cal/<token>.ics` голый токен, без обращения к БД. */
function tokenFromUrl(url: string): string {
  return url.split("/cal/")[1]!.replace(/\.ics$/, "");
}

describe("подписка на личный календарь", () => {
  it("GET без подключённой подписки — url: null", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 301, "Аня");
    const token = await tokenFor(app, 301);

    const res = await app.request("/api/me/calendar", auth(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
  });

  it("POST создаёт ссылку на .ics, начинающуюся с publicUrl", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 302, "Аня");
    const token = await tokenFor(app, 302);

    const res = await app.request("/api/me/calendar", post(token));
    const body = (await res.json()) as { url: string };

    expect(res.status).toBe(200);
    expect(body.url.startsWith(config.publicUrl)).toBe(true);
    expect(body.url.endsWith(".ics")).toBe(true);
  });

  it("второй POST выдаёт другой токен — старая ссылка перестаёт работать", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 303, "Аня");
    const token = await tokenFor(app, 303);

    const first = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;
    const second = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;

    expect(second).not.toBe(first);
    const oldRes = await app.request(`/cal/${tokenFromUrl(first)}.ics`);
    expect(oldRes.status).toBe(404);
    const newRes = await app.request(`/cal/${tokenFromUrl(second)}.ics`);
    expect(newRes.status).toBe(200);
  });

  it("публичная ссылка отдаёт только свои смены, не Игоря, без авторизации", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = worker(db, 304, "Аня");
    const igor = worker(db, 305, "Игорь");
    createShift(db, { date: today, start: "09:00", end: "18:00", category: "shift", title: "Своя смена", employeeId: anya.id });
    createShift(db, { date: today, start: "09:00", end: "18:00", category: "shift", title: "Смена Игоря", employeeId: igor.id });
    const token = await tokenFor(app, 304);

    const url = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;
    const res = await app.request(`/cal/${tokenFromUrl(url)}.ics`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("Своя смена");
    expect(body).not.toContain("Смена Игоря");
  });

  it("окно −30..+180: −31 не входит, −30 входит, +180 входит, +181 не входит", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = worker(db, 306, "Аня");
    const dates = {
      tooOld: addDaysIso(today, -31),
      oldEdge: addDaysIso(today, -30),
      farEdge: addDaysIso(today, 180),
      tooFar: addDaysIso(today, 181),
    };
    for (const [label, date] of Object.entries(dates)) {
      createShift(db, { date, category: "vacation", title: `Метка ${label}`, employeeId: anya.id });
    }
    const token = await tokenFor(app, 306);
    const url = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;

    const body = await (await app.request(`/cal/${tokenFromUrl(url)}.ics`)).text();

    expect(body).not.toContain("Метка tooOld");
    expect(body).toContain("Метка oldEdge");
    expect(body).toContain("Метка farEdge");
    expect(body).not.toContain("Метка tooFar");
  });

  it("неизвестный токен — 404", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });

    const res = await app.request("/cal/no-such-token.ics");

    expect(res.status).toBe(404);
  });

  it("токен архивного владельца — 404", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const anya = worker(db, 307, "Аня");
    const token = await tokenFor(app, 307);
    const url = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;
    archiveEmployee(db, anya.id, today);

    const res = await app.request(`/cal/${tokenFromUrl(url)}.ics`);

    expect(res.status).toBe(404);
  });

  it("DELETE гасит подписку — старая ссылка отвечает 404", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 308, "Аня");
    const token = await tokenFor(app, 308);
    const url = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;

    const delRes = await app.request("/api/me/calendar", del(token));
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });

    const getMe = await app.request("/api/me/calendar", auth(token));
    expect(await getMe.json()).toEqual({ url: null });

    const publicRes = await app.request(`/cal/${tokenFromUrl(url)}.ics`);
    expect(publicRes.status).toBe(404);
  });

  it("токен не приходит в bootstrap", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 309, "Аня");
    const token = await tokenFor(app, 309);
    await app.request("/api/me/calendar", post(token));

    const res = await app.request("/api/bootstrap", auth(token));
    const text = await res.text();

    expect(text).not.toContain("calendarToken");
    expect(text).not.toContain("calendar_token");
  });

  it("токен не приходит в /api/admin/employees — тот класс утечки, что был у inviteToken (ledger 2026-08-11)", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    // Аллоулистнутый telegram id из testConfig() создаёт себе админскую строку
    // прямо на первом входе — так уже устроен /api/auth, отдельно заводить не нужно.
    const adminToken = await tokenFor(app, config.adminTelegramIds[0]!);
    worker(db, 310, "Аня");
    const workerToken = await tokenFor(app, 310);
    await app.request("/api/me/calendar", post(workerToken));

    const res = await app.request("/api/admin/employees", auth(adminToken));
    const text = await res.text();

    expect(text).not.toContain("calendarToken");
    expect(text).not.toContain("calendar_token");
  });

  it("61-й запрос за минуту — 429", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    worker(db, 311, "Аня");
    const token = await tokenFor(app, 311);
    const url = ((await (await app.request("/api/me/calendar", post(token))).json()) as { url: string }).url;
    const path = `/cal/${tokenFromUrl(url)}.ics`;

    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await app.request(path);
    }

    expect(last!.status).toBe(429);
  });
});
