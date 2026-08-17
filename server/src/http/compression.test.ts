import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Ответы сервера едут сжатыми.
 *
 * Мини-апп грузится через облачный релей KeenDNS с телефона, и до этой правки
 * сервер отдавал его несжатым вовсе: `Accept-Encoding: gzip, br` в запросе,
 * никакого `Content-Encoding` в ответе, `Content-Length: 558486` на один только
 * бандл. Сжатый тот же бандл — 157 КБ, то есть каждый холодный вход стоил в 3.5
 * раза больше байт, чем нужно. А холодным он становится после КАЖДОГО деплоя:
 * хеш файла меняется, и `immutable`-кэш телефона перестаёт подходить.
 *
 * Проверяется на API-ответе, потому что раздача `/app/` монтируется в
 * `index.ts` (тесты поднимают только `createApp`), а middleware один и тот же на
 * всё приложение — статика идёт через него же.
 */
const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);

async function adminApp() {
  const db = makeTestDb();
  // Тридцать человек — чтобы ответ был заметно больше порога в 1 КБ, как в жизни.
  // Ниже ждём 31: allowlisted-админ заводит себе строку при первом входе.
  for (let i = 0; i < 30; i += 1) createEmployee(db, { displayName: `Работник ${i}` });
  const app = createApp({ db, config });
  const token = (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(111) }),
  }))).json()).token as string;
  return { app, token };
}

describe("сжатие ответов", () => {
  it("клиент просит gzip — получает gzip, и в нём те же данные", async () => {
    const { app, token } = await adminApp();

    const res = await app.request("/api/admin/employees", {
      headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    // Сжатие не должно менять смысл: распаковали — получили тот же JSON.
    const raw = Buffer.from(await res.arrayBuffer());
    const decoded = JSON.parse(gunzipSync(raw).toString("utf8")) as { employees: unknown[] };
    expect(decoded.employees).toHaveLength(31);
    // И оно должно быть настоящей экономией, а не обёрткой ради заголовка.
    expect(raw.byteLength).toBeLessThan(gunzipSync(raw).byteLength / 2);
  });

  it("кэши не перепутают сжатый ответ с несжатым", async () => {
    const { app, token } = await adminApp();

    const res = await app.request("/api/admin/employees", {
      headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" },
    });

    // Без `Vary` промежуточный кэш (у нас это релей KeenDNS) может отдать
    // сжатое тело клиенту, который сжатия не просил.
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
  });

  it("клиент, который не просил сжатия, получает как было", async () => {
    const { app, token } = await adminApp();

    const res = await app.request("/api/admin/employees", { headers: { Authorization: `Bearer ${token}` } });

    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.json()).employees).toHaveLength(31);
  });

  // Порог «меньше килобайта не сжимаем» у hono проверяется по `Content-Length`, а
  // `c.json()` его не ставит — значит мелкие ответы тоже едут сжатыми. Это
  // осознанно оставлено как есть: лишние байты на такой ответ — единицы, а выигрыш
  // на расписании (27 КБ) и на бандле (558 КБ) — то, ради чего всё делается.
  // Тест держит не размер, а то, что мелкий ответ по-прежнему читается.
  it("мелкий ответ тоже сжимается, и он по-прежнему читается", async () => {
    const { app } = await adminApp();

    const res = await app.request("/api/health", { headers: { "Accept-Encoding": "gzip" } });

    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"))).toEqual({ ok: true });
  });
});
