import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * `from` в чтениях работника — дата, а не любая строка.
 *
 * Обе ручки сравнивают `from` с датами в базе как строки: «abc» больше любой
 * даты, и ответ молча пустел — экран говорил «смен нет» вместо «запрос кривой».
 * Остальные ручки с датами в query уже проверяют их `dateStr`; эти две — нет.
 */

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Марк" }) }, config.botToken);

async function workerApp() {
  const db = makeTestDb();
  createEmployee(db, { displayName: "Марк", inviteToken: "inv-mark" });
  linkTelegramAccount(db, "inv-mark", 555);
  const app = createApp({ db, config });
  const res = await app.request("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: initDataFor(555) }),
  });
  const token = ((await res.json()) as { token: string }).token;
  const get = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${token}` } });
  return { get };
}

describe.each(["/api/my/shifts", "/api/weekend/slots"])("%s?from=", (path) => {
  it.each(["abc", "2026-13-01", "2026-02-30", "2026-1-5", "' OR 1=1 --"])("мусор «%s» — 400", async (from) => {
    const { get } = await workerApp();
    const res = await get(`${path}?from=${encodeURIComponent(from)}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Дата «from» должна быть в виде ГГГГ-ММ-ДД");
  });

  it("настоящая дата и отсутствие from — 200", async () => {
    const { get } = await workerApp();
    expect((await get(`${path}?from=2026-10-15`)).status).toBe(200);
    expect((await get(path)).status).toBe(200);
  });
});
