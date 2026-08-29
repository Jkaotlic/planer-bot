import { describe, it, expect, vi } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createApp } from "./app";
import { signInitData } from "../auth/telegram";

const BOT_TOKEN = "123:test-token";
const config = {
  jwtSecret: "s",
  botToken: BOT_TOKEN,
  teamTz: "Europe/Moscow",
  publicUrl: "http://x",
  adminTelegramIds: [],
} as any;

function initDataFor(id: number, atSec: number): string {
  return signInitData(
    { auth_date: String(atSec), user: JSON.stringify({ id, first_name: "Аня" }) },
    BOT_TOKEN,
  );
}

/**
 * Отказ входа обязан оставлять след.
 *
 * Полтора месяца мини-апп не открывался у части команды, и узнать почему было
 * НЕЧЕМ: `~/planer-bot.log` содержал только строки о старте процесса. Отказ
 * молча уезжал в 401 или 403, человек видел экран с ошибкой и закрывал
 * приложение, а на сервере не оставалось ничего — ни кто, ни когда, ни почему.
 */
describe("отказ входа виден в логе", () => {
  it("непривязанный telegram id пишется в лог вместе с причиной", async () => {
    const app = createApp({ db: makeTestDb(), config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await app.request("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: initDataFor(999_111, Math.floor(Date.now() / 1000)) }),
    });

    expect(res.status).toBe(403);
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("999111");
    expect(logged).toContain("not_registered");
    warn.mockRestore();
  });

  it("непринятая подпись тоже пишется — иначе 401 неотличим от «человек не заходил»", async () => {
    const app = createApp({ db: makeTestDb(), config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await app.request("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: "hash=deadbeef&auth_date=1" }),
    });

    expect(res.status).toBe(401);
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("invalid_init_data");
    warn.mockRestore();
  });

  it("удачный вход в лог не пишет — иначе он утонет в шуме", async () => {
    const db = makeTestDb();
    const { createEmployee, linkTelegramAccount } = await import("../repo/employees");
    createEmployee(db, { displayName: "Аня", inviteToken: "i1" });
    linkTelegramAccount(db, "i1", 555_222, "anya", "Аня");
    const app = createApp({ db, config });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await app.request("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: initDataFor(555_222, Math.floor(Date.now() / 1000)) }),
    });

    expect(res.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
