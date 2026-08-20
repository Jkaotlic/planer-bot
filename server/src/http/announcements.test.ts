import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount, setEmployeeObserver } from "../repo/employees";
import { issueToken } from "../auth/jwt";
import { createApp } from "./app";
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_RECIPIENTS_MAX } from "../announcements/announcement-service";
import { listRecentAudit } from "../repo/audit";
import type { Db } from "../db/client";

const config = { jwtSecret: "s", teamTz: "Europe/Moscow", publicUrl: "http://x", adminTelegramIds: [] } as any;

async function tokenFor(id: number, isAdmin: boolean) {
  return issueToken({ employeeId: id, isAdmin }, config.jwtSecret);
}

function linked(db: Db, name: string, tgId: number, isAdmin = false) {
  const e = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}`, isAdmin });
  linkTelegramAccount(db, `i-${tgId}`, tgId);
  return e;
}

/** Наблюдатель с телеграмом — как `linked`, но с ролью. */
function observerLinked(db: Db, name: string, tgId: number) {
  const e = linked(db, name, tgId);
  setEmployeeObserver(db, e.id, true);
  return e;
}

/** A bot that records what it was asked to send instead of talking to Telegram. */
function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  const bot = { api: { sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }) } };
  return { bot: bot as unknown as Bot, sent };
}

describe("POST /api/announcements", () => {
  it("работнику отвечает 403 — рассылать умеют только админы и наблюдатели", async () => {
    const db = makeTestDb();
    const marc = linked(db, "Марк", 111);
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(marc.id, false)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: "all" }),
    });
    expect(res.status).toBe(403);
  });

  // Спека называет оба случая явно (§«Проверка»), и `requireAnnouncer` их
  // обрабатывает раньше `canAnnounce` — но до сих пор их не проверял ни один тест.
  it("без токена — 401, а не 403", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: "all" }),
    });
    expect(res.status).toBe(401);
  });

  it("архивный наблюдатель — 401: роль не действует у неактивного", async () => {
    const db = makeTestDb();
    const anya = observerLinked(db, "Аня", 631);
    const token = await tokenFor(anya.id, false);
    archiveEmployee(db, anya.id, "9999-01-01");
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: "all" }),
    });
    expect(res.status).toBe(401);
  });

  it("наблюдатель рассылает, работник — нет", async () => {
    const db = makeTestDb();
    const anya = observerLinked(db, "Аня", 631);
    const igor = linked(db, "Игорь", 632);
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });

    const okRes = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, false)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Завтра планёрка в 10", audience: "all" }),
    });
    expect(okRes.status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([632]);

    const denied = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(igor.id, false)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "И мне можно?", audience: "all" }),
    });
    expect(denied.status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it("рассылка наблюдателя оставляет след в журнале", async () => {
    const db = makeTestDb();
    const me = observerLinked(db, "Марк", 633);
    linked(db, "Даша", 634);
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });

    await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(me.id, false)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Тест", audience: "all" }),
    });

    const entry = listRecentAudit(db, 10).find((a) => a.type === "announcement_sent");
    expect(entry?.actorEmployeeId).toBe(me.id);
  });

  it("пустой текст — 400", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   ", audience: "all" }),
    });
    expect(res.status).toBe(400);
  });

  it("текст длиннее лимита — 400", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "а".repeat(ANNOUNCEMENT_TEXT_MAX + 1), audience: "all" }),
    });
    expect(res.status).toBe(400);
  });

  it("пустой список адресатов при picked — 400", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("адресатов больше потолка — 400, а не рассылка на весь чат бота", async () => {
    // Потолок про то, что один процесс обслуживает и HTTP API, и long-polling
    // бота: «широкая» рассылка задела бы чат всей команды. Реальные сотрудники
    // тут не нужны — проверка длины срабатывает раньше, чем список адресатов
    // вообще смотрит в базу.
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });
    const ids = Array.from({ length: ANNOUNCEMENT_RECIPIENTS_MAX + 1 }, (_, i) => i + 1000);

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: ids }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/адресат/i);
  });

  it("ровно на потолке — принимается", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });
    const ids = Array.from({ length: ANNOUNCEMENT_RECIPIENTS_MAX }, (_, i) => i + 1000);

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: ids }),
    });
    expect(res.status).toBe(200);
  });

  it("нормальная рассылка — 200, отчёт о доставке, и строка в журнале", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const igor = linked(db, "Игорь", 222);
    linked(db, "Марк", 333);
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание в 15:00", audience: [igor.id] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivered: number; intended: number; unreachable: string[] };
    // Бота у тестового приложения нет (`createApp({ db, config })` без `bot`),
    // поэтому `delivered` — 0: важно, что маршрут не падает и честно докладывает.
    expect(body).toEqual({ delivered: 0, intended: 1, unreachable: [] });

    const journal = await app.request("/api/admin/journal", {
      headers: { Authorization: `Bearer ${await tokenFor(anya.id, true)}` },
    });
    const events = (await journal.json()).events as { type: string }[];
    expect(events.some((e) => e.type === "announcement_sent")).toBe(true);
  });
});

describe("GET /api/announcements/recipients", () => {
  it("отдаёт имена без телефонов и токенов, и без самого отправителя", async () => {
    const db = makeTestDb();
    const me = observerLinked(db, "Аня", 635);
    const mate = linked(db, "Игорь", 636);
    // Не привязан к телеграму — виден и назван, но не «достижим»: если бы он
    // пропадал из списка, отправитель решил бы, что письмо ему всё равно ушло.
    const noTelegram = createEmployee(db, { displayName: "Марк", inviteToken: "i-noreach" });
    const app = createApp({ db, config });

    const res = await app.request("/api/announcements/recipients", {
      headers: { Authorization: `Bearer ${await tokenFor(me.id, false)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipients: { id: number; displayName: string; reachable: boolean }[] };

    expect(body.recipients).toEqual(
      expect.arrayContaining([
        { id: mate.id, displayName: "Игорь", reachable: true },
        { id: noTelegram.id, displayName: "Марк", reachable: false },
      ]),
    );
    expect(body.recipients).toHaveLength(2);
    expect(body.recipients.map((r) => r.id)).not.toContain(me.id);
  });

  it("работнику список не показывают", async () => {
    const db = makeTestDb();
    const marc = linked(db, "Марк", 637);
    const app = createApp({ db, config });
    const res = await app.request("/api/announcements/recipients", {
      headers: { Authorization: `Bearer ${await tokenFor(marc.id, false)}` },
    });
    expect(res.status).toBe(403);
  });
});
