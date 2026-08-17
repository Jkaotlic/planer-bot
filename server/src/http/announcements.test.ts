import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { issueToken } from "../auth/jwt";
import { createApp } from "./app";
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_RECIPIENTS_MAX } from "../announcements/announcement-service";
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

describe("POST /api/admin/announcements", () => {
  it("работнику отвечает 403 — рассылать умеют только админы", async () => {
    const db = makeTestDb();
    const marc = linked(db, "Марк", 111);
    const app = createApp({ db, config });

    const res = await app.request("/api/admin/announcements", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenFor(marc.id, false)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Собрание", audience: "all" }),
    });
    expect(res.status).toBe(403);
  });

  it("пустой текст — 400", async () => {
    const db = makeTestDb();
    const anya = linked(db, "Аня", 111, true);
    const app = createApp({ db, config });

    const res = await app.request("/api/admin/announcements", {
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

    const res = await app.request("/api/admin/announcements", {
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

    const res = await app.request("/api/admin/announcements", {
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

    const res = await app.request("/api/admin/announcements", {
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

    const res = await app.request("/api/admin/announcements", {
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

    const res = await app.request("/api/admin/announcements", {
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
