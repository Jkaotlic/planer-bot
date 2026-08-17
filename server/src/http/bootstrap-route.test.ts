import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Один запрос вместо семи на старте мини-аппа.
 *
 * Мини-апп открывают с телефона через облачный релей KeenDNS, и замер этого пути
 * дал: TLS-рукопожатие 1.5–6.8 с, скорость 11–58 КБ/с, только HTTP/1.1 — то есть
 * без мультиплексирования. Старт при этом делал две волны: `/api/me`, а следом
 * шесть запросов параллельно, под каждый из которых браузер открывает своё
 * соединение со своим рукопожатием. Байты тут не главное: главное — число
 * соединений.
 *
 * Ответы НЕ собираются заново: роут опрашивает те же самые роуты внутри процесса
 * (`app.request`), поэтому форма ответа физически одна и разъехаться не может.
 * Тест это и проверяет — сверкой с ответами отдельных ручек.
 */
const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

async function stage() {
  const db = makeTestDb();
  const worker = createEmployee(db, { displayName: "Аня Работникова", inviteToken: "i-201" });
  linkTelegramAccount(db, "i-201", 201);
  createShift(db, { date: "2099-09-14", start: "08:00", end: "17:00", category: "shift", title: "Утро", employeeId: worker.id });
  const app = createApp({ db, config });
  const token = (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(201) }),
  }))).json()).token as string;
  const authed = { headers: { Authorization: `Bearer ${token}` } };
  return { db, app, authed };
}

describe("GET /api/bootstrap", () => {
  it("отдаёт ровно то же, что семь отдельных ручек", async () => {
    const { app, authed } = await stage();
    const from = "2099-09-14";
    const to = "2099-09-20";

    const boot = await (await app.request(`/api/bootstrap?from=${from}&to=${to}`, authed)).json();

    // Каждая часть сверяется с первоисточником — так тест ловит и расхождение
    // формы, и потерю поля, чего проверка «поле присутствует» не поймала бы.
    const jsonOf = async (path: string) => await (await app.request(path, authed)).json();
    expect(boot.me).toEqual(await jsonOf("/api/me"));
    expect(boot.myShifts).toEqual(await jsonOf("/api/my/shifts"));
    expect(boot.teamSchedule).toEqual(await jsonOf(`/api/team/schedule?from=${from}&to=${to}`));
    expect(boot.templates).toEqual(await jsonOf("/api/templates"));
    expect(boot.swaps).toEqual(await jsonOf("/api/swaps"));
    expect(boot.weekendSlots).toEqual(await jsonOf("/api/weekend/slots"));
    expect(boot.weekendOffers).toEqual(await jsonOf("/api/weekend/offers"));
  });

  it("несёт настоящие данные, а не пустые заготовки", async () => {
    const { app, authed } = await stage();

    const boot = await (await app.request("/api/bootstrap?from=2099-09-14&to=2099-09-20", authed)).json();

    expect(boot.me.displayName).toBe("Аня Работникова");
    expect(boot.myShifts.shifts).toHaveLength(1);
    expect(boot.myShifts.shifts[0].title).toBe("Утро");
    expect(boot.templates.templates.length).toBeGreaterThan(0);
    expect(boot.teamSchedule.shifts).toHaveLength(1);
  });

  it("без токена — 401, как и всё остальное", async () => {
    const { app } = await stage();

    expect((await app.request("/api/bootstrap?from=2099-09-14&to=2099-09-20")).status).toBe(401);
  });

  it("плохой диапазон отвергается тем же ответом, что у расписания", async () => {
    const { app, authed } = await stage();

    const res = await app.request("/api/bootstrap?from=2099-09-20&to=2099-09-14", authed);

    expect(res.status).toBe(400);
    // Причина берётся у той ручки, которая её и придумала, а не пишется заново.
    expect((await res.json()).error).toBe((await (await app.request("/api/team/schedule?from=2099-09-20&to=2099-09-14", authed)).json()).error);
  });
});
