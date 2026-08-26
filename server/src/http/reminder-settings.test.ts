import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { listActiveTemplates, getTemplate } from "../repo/templates";
import { reminderHour } from "../repo/settings";
import { listRecentAudit } from "../repo/audit";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Час рассылки и свой текст напоминания — две ручки, которых у админа не было:
 * час лежал константой в `reminder-service`, текст — четырьмя формулировками в
 * `shared/reminder`. Оба маршрута обязаны не пустить в базу то, что потом уйдёт
 * команде: час, который может не наступить, и подстановку, которой нет.
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

describe("PUT /api/admin/settings/reminder-hour", () => {
  it("сохраняет час и пишет в журнал", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });

    const res = await app.request("/api/admin/settings/reminder-hour", send(await tokenFor(app, 111), { hour: "18:00" }));

    expect(res.status).toBe(200);
    expect(reminderHour(db)).toBe("18:00");
    expect(listRecentAudit(db, 5)[0]!.type).toBe("reminder_hour_changed");
  });

  it("отказывает часу, который может не наступить до полуночи", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });

    const res = await app.request("/api/admin/settings/reminder-hour", send(await tokenFor(app, 111), { hour: "23:45" }));

    expect(res.status).toBe(400);
    // Отказ не должен оставить половину: час прежний.
    expect(reminderHour(db)).toBe("20:00");
  });

  it("отказывает всему, что не ЧЧ:ММ", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    expect((await app.request("/api/admin/settings/reminder-hour", send(token, { hour: "вечером" }))).status).toBe(400);
    expect((await app.request("/api/admin/settings/reminder-hour", send(token, { hour: 20 }))).status).toBe(400);
    expect(reminderHour(db)).toBe("20:00");
  });

  it("не пускает работника", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);

    const res = await app.request("/api/admin/settings/reminder-hour", send(await tokenFor(app, 333), { hour: "18:00" }));

    expect(res.status).toBe(403);
  });

  it("GET /api/admin/settings отдаёт час: сперва тот, что был до настройки", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);

    expect((await (await app.request("/api/admin/settings", auth(token))).json()).reminderHour).toBe("20:00");

    await app.request("/api/admin/settings/reminder-hour", send(token, { hour: "21:15" }));
    const after = await (await app.request("/api/admin/settings", auth(token))).json();
    expect(after.reminderHour).toBe("21:15");
    expect(after.reminderHourUpdatedBy).toBeTypeOf("string");
  });
});

describe("PUT /api/admin/templates/:id/reminder", () => {
  it("сохраняет галочку и свой текст, пишет в журнал", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const templateId = listActiveTemplates(db)[0]!.id;

    const res = await app.request(`/api/admin/templates/${templateId}/reminder`,
      send(await tokenFor(app, 111), { sendReminder: true, reminderText: "{имя}, завтра {время}" }));

    expect(res.status).toBe(200);
    const template = getTemplate(db, templateId)!;
    expect(template.sendReminder).toBe(true);
    expect(template.reminderText).toBe("{имя}, завтра {время}");
    expect(listRecentAudit(db, 5)[0]!.type).toBe("template_reminder_changed");
  });

  it("пустой текст значит «вернуть стандартный» и ложится в колонку как null", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const templateId = listActiveTemplates(db)[0]!.id;
    await app.request(`/api/admin/templates/${templateId}/reminder`, send(token, { sendReminder: true, reminderText: "свой" }));

    await app.request(`/api/admin/templates/${templateId}/reminder`, send(token, { sendReminder: true, reminderText: "   " }));

    expect(getTemplate(db, templateId)!.reminderText).toBeNull();
  });

  it("отказывает неизвестной подстановке и называет её", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const templateId = listActiveTemplates(db)[0]!.id;

    const res = await app.request(`/api/admin/templates/${templateId}/reminder`,
      send(await tokenFor(app, 111), { sendReminder: true, reminderText: "Завтра {погода}" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("погода");
    // Ни текста, ни галочки: отказ не пишет половину.
    expect(getTemplate(db, templateId)!.reminderText).toBeNull();
    expect(getTemplate(db, templateId)!.sendReminder).toBe(true); // 0030 засеяла «Утро» напоминанием
  });

  it("отказывает тексту длиннее предела", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const templateId = listActiveTemplates(db)[0]!.id;

    const res = await app.request(`/api/admin/templates/${templateId}/reminder`,
      send(await tokenFor(app, 111), { sendReminder: true, reminderText: "а".repeat(401) }));

    expect(res.status).toBe(400);
    expect(getTemplate(db, templateId)!.reminderText).toBeNull();
  });

  it("отказывает неизвестному виду смены", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request("/api/admin/templates/9999/reminder",
      send(await tokenFor(app, 111), { sendReminder: true, reminderText: null }));
    expect(res.status).toBe(404);
  });

  it("не пускает работника", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-334" });
    linkTelegramAccount(db, "inv-334", 334);
    const templateId = listActiveTemplates(db)[0]!.id;

    const res = await app.request(`/api/admin/templates/${templateId}/reminder`,
      send(await tokenFor(app, 334), { sendReminder: false, reminderText: null }));

    expect(res.status).toBe(403);
  });

  it("отдаёт галочку и текст вместе с ролями — экран читает их одним запросом", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const templateId = listActiveTemplates(db)[0]!.id;
    await app.request(`/api/admin/templates/${templateId}/reminder`, send(token, { sendReminder: false, reminderText: "Завтра {время}" }));

    const { templates } = await (await app.request("/api/admin/templates/roles", auth(token))).json();

    const kind = templates.find((t: { templateId: number }) => t.templateId === templateId);
    expect(kind.sendReminder).toBe(false);
    expect(kind.reminderText).toBe("Завтра {время}");
  });
});
