import { describe, expect, it } from "vitest";
import { signInitData } from "../auth/telegram";
import { collections } from "../db/schema";
import { makeTestDb } from "../db/testdb";
import { listRecentAudit } from "../repo/audit";
import { createEmployee, getEmployeeById, setBirthDate } from "../repo/employees";
import { testConfig } from "../test-config";
import { createApp } from "./app";

async function setup() {
  const db = makeTestDb();
  const config = testConfig();
  const app = createApp({ db, config });
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 111, first_name: "Аня" }),
  }, config.botToken);
  const auth = await app.request("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  expect(auth.status).toBe(200);
  const { token } = await auth.json() as { token: string };
  const employee = createEmployee(db, { displayName: "Марк" });
  setBirthDate(db, employee.id, "08-15");

  const request = (method: string, path: string, body?: string) => app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  });
  return { db, employee, request };
}

describe("JSON null в теле изменения с обязательными полями", () => {
  it.each([
    ["POST", "/api/announcements"],
    ["PUT", "/api/admin/calendar/2026-11-20"],
    ["POST", "/api/admin/collections/:id/send"],
    ["POST", "/api/admin/collections/:id/remind-unpaid"],
    ["POST", "/api/admin/collections/:id/close"],
    ["POST", "/api/admin/bug-reports/1/resolve"],
    ["POST", "/api/swaps"],
    ["POST", "/api/admin/weekend/slots"],
    ["POST", "/api/admin/weekend/slots/1/assign"],
    ["POST", "/api/admin/roster/import/preview"],
    ["POST", "/api/admin/roster/import/apply"],
    ["POST", "/api/admin/employees"],
    ["PATCH", "/api/admin/employees/:employeeId"],
    ["POST", "/api/admin/employees/:employeeId/order"],
    ["POST", "/api/admin/employees/:employeeId/role"],
  ])("%s %s возвращает 400", async (method, pattern) => {
    const { db, employee, request } = await setup();
    let path = pattern.replace(":employeeId", String(employee.id));
    if (path.includes(":id")) {
      const created = await request("POST", "/api/admin/collections", JSON.stringify({ title: "Общий сбор" }));
      expect(created.status).toBe(200);
      const { collection } = await created.json() as { collection: { id: number } };
      path = path.replace(":id", String(collection.id));
    }
    const audit = listRecentAudit(db, 10);

    const rejected = await request(method, path, "null");

    expect(rejected.status).toBe(400);
    expect(listRecentAudit(db, 10)).toEqual(audit);
  });
});

describe("JSON-тело с необязательными полями", () => {
  it.each(["null", "[]", "true", '"текст"'])("отклоняет %s без выдачи приглашения и создания сбора", async (body) => {
    const { db, employee, request } = await setup();
    const audit = listRecentAudit(db, 10);

    const invite = await request("POST", `/api/admin/employees/${employee.id}/invite`, body);
    const birthday = await request("PUT", `/api/admin/birthdays/${employee.id}?asOf=2026-08-10`, body);

    expect.soft(invite.status).toBe(400);
    expect.soft(birthday.status).toBe(400);
    expect.soft(getEmployeeById(db, employee.id)?.inviteToken === null).toBe(true);
    expect.soft(db.select().from(collections).all()).toHaveLength(0);
    expect.soft(listRecentAudit(db, 10)).toEqual(audit);
  });

  it.each([undefined, "{"])("сохраняет необязательное тело %s в обоих маршрутах", async (body) => {
    const { db, employee, request } = await setup();

    const invite = await request("POST", `/api/admin/employees/${employee.id}/invite`, body);
    const birthday = await request("PUT", `/api/admin/birthdays/${employee.id}?asOf=2026-08-10`, body);

    expect(invite.status).toBe(200);
    expect(birthday.status).toBe(200);
    expect(getEmployeeById(db, employee.id)?.inviteToken).toEqual(expect.any(String));
    expect(db.select().from(collections).all()).toHaveLength(1);
  });
});
