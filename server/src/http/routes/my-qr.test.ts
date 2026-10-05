import { describe, expect, it } from "vitest";
import { Bot, GrammyError } from "grammy";
import { Hono } from "hono";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { createMyQrRoutes, QR_SEND_COOLDOWN_MS } from "./my-qr";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, getEmployeeById, linkTelegramAccount } from "../../repo/employees";
import { issueToken } from "../../auth/jwt";
import { recordApi, stubBotInfo, type ApiCall } from "../../bot/testbot";
import { renderQrPng } from "../../bot/qr-image";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";
import type { Env } from "../middleware";

const config = testConfig();
const URL_TEXT = "https://example.com/sbor";

function linked(db: Db, name: string, tg: number) {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${tg}` });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  return e;
}

/** Routes mounted alone with a hand-driven clock: the cooldown is about elapsed ms. */
function stage(opts: { bot?: Bot | null } = {}) {
  const db = makeTestDb();
  let clock = 1_700_000_000_000;
  const bot = opts.bot === undefined ? stubBotInfo(new Bot("12345:tok")) : opts.bot ?? undefined;
  const api = bot && opts.bot === undefined ? recordApi(bot) : null;
  const app = new Hono<Env>().route("/", createMyQrRoutes({ db, config, bot, now: () => clock }));
  return { db, app, api, tick: (ms: number) => { clock += ms; } };
}

async function as(employeeId: number) {
  return `Bearer ${await issueToken({ employeeId, isAdmin: false }, config.jwtSecret)}`;
}

function post(token: string, body: unknown) {
  return { method: "POST", headers: { Authorization: token, "content-type": "application/json" }, body: JSON.stringify(body) };
}

function put(token: string, body: unknown) {
  return { method: "PUT", headers: { Authorization: token, "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function decodePhoto(call: ApiCall): Promise<string | null> {
  const image = PNG.sync.read(Buffer.from(await call.payload.photo.toRaw()));
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

const photos = (calls: ApiCall[]) => calls.filter((c) => c.method === "sendPhoto");

describe("PUT /api/my/qr-style", () => {
  it("запоминает форму и цвет того, кто спросил, и никого больше", async () => {
    const { db, app } = stage();
    const anya = linked(db, "Аня", 333);
    const igor = linked(db, "Игорь", 444);

    const res = await app.request("/api/my/qr-style", put(await as(anya.id), { shape: "soft", color: "green" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ qrStyle: { shape: "soft", color: "green" } });
    expect(JSON.parse(getEmployeeById(db, anya.id)!.qrStyle!)).toEqual({ shape: "soft", color: "green" });
    expect(getEmployeeById(db, igor.id)!.qrStyle).toBeNull();
  });

  it("неизвестный цвет и лишнее поле — 400 по-русски, ничего не записано", async () => {
    const { db, app } = stage();
    const anya = linked(db, "Аня", 333);
    for (const body of [{ shape: "dots", color: "pink" }, { shape: "dots", color: "blue", caption: "x" }]) {
      const res = await app.request("/api/my/qr-style", put(await as(anya.id), body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/[А-Яа-я]/);
    }
    expect(getEmployeeById(db, anya.id)!.qrStyle).toBeNull();
  });
});

describe("POST /api/my/qr", () => {
  it("бот присылает тому, кто нажал, картинку в его стиле, которую сканер читает; стиль запомнен без подписи", async () => {
    const { db, app, api } = stage();
    const anya = linked(db, "Аня", 333);
    const style = { shape: "dots", color: "blue", caption: "Сбор на кофемашину" } as const;

    const res = await app.request("/api/my/qr", post(await as(anya.id), { text: URL_TEXT, style }));

    expect(res.status).toBe(200);
    const [photo] = photos(api!.calls);
    expect(photo!.payload.chat_id).toBe(333);
    expect(photo!.payload.caption).toBe(URL_TEXT);
    expect(await decodePhoto(photo!)).toBe(URL_TEXT);
    expect(Buffer.from(await photo!.payload.photo.toRaw())).toEqual(renderQrPng(URL_TEXT, style));
    expect(JSON.parse(getEmployeeById(db, anya.id)!.qrStyle!)).toEqual({ shape: "dots", color: "blue" });
  });

  it("второй раз за 5 секунд — 429 со словами и Retry-After, фото одно; через 5 секунд — снова можно", async () => {
    const { db, app, api, tick } = stage();
    const anya = linked(db, "Аня", 333);
    const token = await as(anya.id);
    const body = { text: URL_TEXT, style: { shape: "classic", color: "black" } };

    expect((await app.request("/api/my/qr", post(token, body))).status).toBe(200);
    tick(QR_SEND_COOLDOWN_MS - 1);
    const again = await app.request("/api/my/qr", post(token, body));
    expect(again.status).toBe(429);
    expect((await again.json()).error).toContain("5 секунд");
    expect(again.headers.get("Retry-After")).toBe("1");
    expect(photos(api!.calls)).toHaveLength(1);

    tick(1);
    expect((await app.request("/api/my/qr", post(token, body))).status).toBe(200);
    expect(photos(api!.calls)).toHaveLength(2);
  });

  it("кулдаун у каждого свой", async () => {
    const { db, app, api } = stage();
    const anya = linked(db, "Аня", 333);
    const igor = linked(db, "Игорь", 444);
    const body = { text: URL_TEXT, style: { shape: "classic", color: "black" } };
    expect((await app.request("/api/my/qr", post(await as(anya.id), body))).status).toBe(200);
    expect((await app.request("/api/my/qr", post(await as(igor.id), body))).status).toBe(200);
    expect(photos(api!.calls).map((c) => c.payload.chat_id)).toEqual([333, 444]);
  });

  it("длиннее 1000 знаков — 400 с пределом, фото нет, кулдаун не потрачен", async () => {
    const { db, app, api } = stage();
    const anya = linked(db, "Аня", 333);
    const token = await as(anya.id);
    const tooLong = await app.request("/api/my/qr", post(token, { text: "a".repeat(1001), style: { shape: "classic", color: "black" } }));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toContain("1000");
    expect(photos(api!.calls)).toHaveLength(0);
    expect((await app.request("/api/my/qr", post(token, { text: URL_TEXT, style: { shape: "classic", color: "black" } }))).status).toBe(200);
  });

  it("длинная кириллица в фигурной форме — 400 с советом про «Классику»", async () => {
    const { db, app } = stage();
    const anya = linked(db, "Аня", 333);
    const res = await app.request("/api/my/qr", post(await as(anya.id), { text: "Ж".repeat(1000), style: { shape: "dots", color: "black" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("«Классику»");
  });

  it("бот не запущен — 503 словами", async () => {
    const { db, app } = stage({ bot: null });
    const anya = linked(db, "Аня", 333);
    const res = await app.request("/api/my/qr", post(await as(anya.id), { text: URL_TEXT, style: { shape: "classic", color: "black" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/[А-Яа-я]/);
  });

  it("человек заблокировал бота — 502 «нажми /start», и повтор можно сразу", async () => {
    const bot = stubBotInfo(new Bot("12345:tok"));
    let attempts = 0;
    bot.api.config.use((_prev, method) => {
      if (method === "sendPhoto") {
        attempts += 1;
        throw new GrammyError("Forbidden", { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, "sendPhoto", {});
      }
      return { ok: true, result: {} } as never;
    });
    const { db, app } = stage({ bot });
    const anya = linked(db, "Аня", 333);
    const token = await as(anya.id);
    const body = { text: URL_TEXT, style: { shape: "classic", color: "black" } };

    const res = await app.request("/api/my/qr", post(token, body));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("/start");
    expect((await app.request("/api/my/qr", post(token, body))).status).toBe(502);
    expect(attempts).toBe(2);
  });

  it("тело больше 16 КБ — 413, до разбора", async () => {
    const { db, app } = stage();
    const anya = linked(db, "Аня", 333);
    const res = await app.request("/api/my/qr", post(await as(anya.id), { text: "a".repeat(20_000), style: { shape: "classic", color: "black" } }));
    expect(res.status).toBe(413);
  });
});

/** A bot whose `sendPhoto` hangs until `release()`: the only deterministic way to have two requests in flight. */
function heldBot(outcome: "ok" | "fail") {
  const bot = stubBotInfo(new Bot("12345:tok"));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let entered!: () => void;
  const enteredFirst = new Promise<void>((r) => { entered = r; });
  let attempts = 0;
  bot.api.config.use(async (_prev, method) => {
    if (method !== "sendPhoto") return { ok: true, result: {} } as never;
    attempts += 1;
    if (attempts > 1) return { ok: true, result: {} } as never;
    entered();
    await gate;
    if (outcome === "fail") throw new Error("telegram down");
    return { ok: true, result: {} } as never;
  });
  return { bot, release, enteredFirst, attempts: () => attempts };
}

describe("POST /api/my/qr — cooldown while the upload is in flight", () => {
  const body = { text: URL_TEXT, style: { shape: "classic", color: "black" } };

  it("второй тап, пока первое фото ещё грузится, — 429 и одна отправка", async () => {
    const held = heldBot("ok");
    const { db, app } = stage({ bot: held.bot });
    const anya = linked(db, "Аня", 333);
    const token = await as(anya.id);

    const a = app.request("/api/my/qr", post(token, body));
    await held.enteredFirst;
    const b = await app.request("/api/my/qr", post(token, body));

    expect(b.status).toBe(429);
    expect(held.attempts()).toBe(1);
    held.release();
    expect((await a).status).toBe(200);
  });

  it("отказ зависшей отправки не снимает метку более новой", async () => {
    const held = heldBot("fail");
    const { db, app, tick } = stage({ bot: held.bot });
    const anya = linked(db, "Аня", 333);
    const token = await as(anya.id);

    const a = app.request("/api/my/qr", post(token, body));
    await held.enteredFirst;
    tick(QR_SEND_COOLDOWN_MS);
    expect((await app.request("/api/my/qr", post(token, body))).status).toBe(200);
    held.release();
    expect((await a).status).toBe(502);

    // B's stamp must survive A's failure: an immediate third tap is still inside B's window.
    expect((await app.request("/api/my/qr", post(token, body))).status).toBe(429);
  });
});

describe("POST /api/my/qr — подпись", () => {
  it("подпись длиннее 40 знаков — 400 с названием предела", async () => {
    const { db, app } = stage();
    const anya = linked(db, "Аня", 333);
    const res = await app.request("/api/my/qr", post(await as(anya.id), { text: URL_TEXT, style: { shape: "classic", color: "black", caption: "я".repeat(41) } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Подпись — не длиннее 40 знаков");
  });
});

describe("маршруты подключены к приложению", () => {
  it("без токена — 401, а не 404", async () => {
    const app = createApp({ db: makeTestDb(), config });
    expect((await app.request("/api/my/qr", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/my/qr-style", { method: "PUT" })).status).toBe(401);
  });
});
