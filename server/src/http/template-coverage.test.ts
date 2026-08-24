import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates } from "../repo/templates";
import { listRecentAudit } from "../repo/audit";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Норма покрытия («сколько людей нужно в этот день недели») до 2026-08-24 лежала
 * в базе без единого писателя. Этот маршрут — первый, и он обязан не пустить в
 * колонку то, что потом никто не прочитает: SQLite на ней ничего не стережёт.
 */
const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const send = (token: string, body: unknown) => ({
  method: "PUT", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("PUT /api/admin/templates/:id/coverage", () => {
  it("сохраняет норму и пишет в журнал", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const templateId = listActiveTemplates(db)[0]!.id;

    const res = await app.request(`/api/admin/templates/${templateId}/coverage`, send(token, { coverage: [2, 2, 2, 2, 2, 0, 0] }));

    expect(res.status).toBe(200);
    expect(listActiveTemplates(db).find((t) => t.id === templateId)!.coverage).toBe("2,2,2,2,2,0,0");
    expect(listRecentAudit(db, 5)[0]!.type).toBe("template_coverage_changed");
  });

  it("отказывает шести числам", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const templateId = listActiveTemplates(db)[0]!.id;
    const res = await app.request(`/api/admin/templates/${templateId}/coverage`,
      send(await tokenFor(app, 111), { coverage: [1, 1, 1, 1, 1, 0] }));
    expect(res.status).toBe(400);
  });

  it("отказывает отрицательному числу", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const templateId = listActiveTemplates(db)[0]!.id;
    const res = await app.request(`/api/admin/templates/${templateId}/coverage`,
      send(await tokenFor(app, 111), { coverage: [1, 1, 1, 1, 1, 0, -1] }));
    expect(res.status).toBe(400);
    // Норма осталась прежней: отказ не должен писать половину.
    expect(listActiveTemplates(db).find((t) => t.id === templateId)!.coverage).toBe("0,0,0,0,0,0,0");
  });

  it("отказывает неизвестному виду смены", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/templates/9999/coverage", send(await tokenFor(app, 111), { coverage: [1, 1, 1, 1, 1, 0, 0] }));
    expect(res.status).toBe(404);
  });

  it("не пускает работника", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const templateId = listActiveTemplates(db)[0]!.id;
    const res = await app.request(`/api/admin/templates/${templateId}/coverage`,
      send(await tokenFor(app, 333), { coverage: [1, 1, 1, 1, 1, 0, 0] }));
    expect(res.status).toBe(403);
  });

  it("отдаёт норму вместе с ролями", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const templateId = listActiveTemplates(db)[0]!.id;
    await app.request(`/api/admin/templates/${templateId}/coverage`, send(token, { coverage: [1, 1, 1, 1, 1, 0, 0] }));

    const { templates } = await (await app.request("/api/admin/templates/roles", auth(token))).json();

    // Числами, а не строкой: фронт считает по ним нехватку дня, и разбор строки
    // на трёх экранах — это три разных разбора через полгода.
    expect(templates.find((t: { templateId: number }) => t.templateId === templateId).coverage).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });
});
